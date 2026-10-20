import type { Env } from "./types";
import { decrypt, fail } from "./security";
import { ZernioClient, ZernioError, type Conversation, type InboxMessage } from "./zernio";
export type Settings = {
  firm_id:string; provider:"meta"|"zernio"; phone_number_id:string; access_token:string|null;
  app_secret:string|null; verify_token_hash:string|null; enabled:number; dry_run:number;
  zernio_account_id:string|null; zernio_api_key:string|null; account_label:string;
};
export async function zernio(env: Env, settings: Settings) {
  if (settings.provider !== "zernio" || !settings.zernio_api_key || !settings.zernio_account_id) fail(400, "Connect a Zernio WhatsApp account first.");
  return new ZernioClient(await decrypt(env,settings.zernio_api_key),settings.zernio_account_id);
}
export async function syncMessages(env: Env, firmId: string, conversation: Conversation, messages: InboxMessage[]) {
  const digits = conversation.participantId.replace(/\D/g,"");
  if (!/^[1-9]\d{7,14}$/.test(digits)) return;
  const phone = `+${digits}`;
  const statements: D1PreparedStatement[] = [];
  for (const m of messages) {
    if (!Number.isFinite(Date.parse(m.created_at))) continue;
    const timestamp = new Date(m.created_at).toISOString();
    const status = ["accepted","sent","delivered","read","failed","received"].includes(m.status) ? m.status : m.direction === "incoming" ? "received" : "accepted";
    statements.push(env.DB.prepare(`INSERT INTO whatsapp_messages(id,firm_id,phone,direction,body,status,provider_id,created_at,actor,conversation_id)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(firm_id,provider_id) DO UPDATE SET
      conversation_id=excluded.conversation_id,
      status=CASE WHEN whatsapp_messages.status='read' THEN 'read'
        WHEN whatsapp_messages.status='delivered' AND excluded.status IN ('accepted','sent') THEN 'delivered'
        ELSE excluded.status END`)
      .bind(crypto.randomUUID(),firmId,phone,m.direction,m.body,status,m.id,timestamp,"WhatsApp via Zernio",conversation.id));
    if (m.direction === "incoming" && /^(stop|cancel|unsubscribe)$/i.test(m.body.trim())) {
      statements.push(env.DB.prepare("UPDATE whatsapp_contacts SET consent=0,enabled=0 WHERE firm_id=? AND phone=? AND consent_updated_at<=?")
        .bind(firmId,phone,timestamp));
    }
  }
  for (let i=0;i<statements.length;i+=40) await env.DB.batch(statements.slice(i,i+40));
}
/** Reconcile consent before sending; never silently truncate the period since approval. */
export async function checkZernioRecipient(env: Env, s: Settings, phone: string, requireReply: boolean, expectedConversationId?: string) {
  const client = await zernio(env,s);
  // Webhooks use an internal ID; phone search/list results can use the platform ID.
  // Resolve the signed event's exact conversation instead of comparing those aliases.
  // getConversation also enforces the configured account and WhatsApp platform.
  const conversation = expectedConversationId
    ? await client.getConversation(expectedConversationId)
    : await client.findPhone(phone);
  if (!conversation) {
    if (requireReply) fail(400, "An approved WhatsApp template is required to start this conversation.");
    return {client,conversationId:undefined};
  }
  const matchesPhone = (value: string) => value.replace(/\D/g, "") === phone.replace(/\D/g, "");
  if (!matchesPhone(conversation.participantId)) fail(403, "The conversation no longer matches this sender.");
  const consent = await env.DB.prepare("SELECT consent_updated_at FROM whatsapp_contacts WHERE firm_id=? AND phone=? AND enabled=1 AND consent=1")
    .bind(s.firm_id,phone).first<{consent_updated_at:string}>();
  if (!consent) fail(403,"Recipient must have messaging consent.");
  const cutoff = Math.min(Date.parse(consent.consent_updated_at) || 0,Date.now()-23*3600000);
  let cursor = "", recentIncoming = false, complete = false;
  const seen = new Set<string>();
  for (let n=0;n<10;n++) {
    const page = await client.messages(conversation.id,cursor,100);
    if (page.conversation.id !== conversation.id || !matchesPhone(page.conversation.participantId)) {
      fail(403, "The conversation no longer matches this sender.");
    }
    await syncMessages(env,s.firm_id,conversation,page.data);
    recentIncoming ||= page.data.some(m => m.direction==="incoming" && Date.parse(m.created_at)>Date.now()-23*3600000);
    if (!page.nextCursor || page.data.some(m=>Date.parse(m.created_at)<cutoff)) {complete=true;break;}
    if (seen.has(page.nextCursor)) fail(503,"WhatsApp pagination did not advance.");
    seen.add(page.nextCursor);cursor=page.nextCursor;
  }
  if (!complete) fail(503,"WhatsApp consent history could not be fully checked. Try again later.");
  const allowed = await env.DB.prepare("SELECT agent_id FROM whatsapp_contacts WHERE firm_id=? AND phone=? AND enabled=1 AND consent=1").bind(s.firm_id,phone).first();
  if (!allowed) fail(403,"The recipient has opted out of WhatsApp messages.");
  if (requireReply && !recentIncoming) fail(400,"An approved WhatsApp template is required outside the reply window.");
  return {client,conversationId:conversation.id};
}
export async function sendProvider(env: Env, s: Settings, phone: string, body: string, key: string,
  template?: {name:string;language:string;parameters:string[]}, conversationId?:string, fetcher:typeof fetch=fetch) {
  try {
    if (s.provider === "zernio") {
      const result = await (await zernio(env,s)).send(phone,body,key,template,conversationId);
      return {status:"accepted",providerId:result.providerId,conversationId:result.conversationId};
    }
    const response = await fetcher(`https://graph.facebook.com/v25.0/${s.phone_number_id}/messages`, {
      method:"POST",redirect:"manual",signal:AbortSignal.timeout(20000),
      headers:{Authorization:`Bearer ${await decrypt(env,s.access_token!)}`,"Content-Type":"application/json"},
      body:JSON.stringify({messaging_product:"whatsapp",to:phone.slice(1),
        ...(template ? {type:"template",template:{name:template.name,language:{code:template.language},
          components:template.parameters.length ? [{type:"body",parameters:template.parameters.map(text=>({type:"text",text}))}] : []}}
          : {type:"text",text:{preview_url:false,body}})}),
    });
    const result = await response.json() as {messages?:{id:string}[]};
    return {status:response.ok ? "accepted" : response.status>=500 ? "uncertain" : "failed",providerId:result.messages?.[0]?.id||null,conversationId:null};
  } catch(error) {
    return {status:error instanceof ZernioError && error.status<500 ? "failed":"uncertain",providerId:null,conversationId:null};
  }
}
