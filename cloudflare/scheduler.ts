import { now } from "./security";
import { checkZernioRecipient, sendProvider, type Settings } from "./whatsapp-provider";
import type { Env } from "./types";
type Due = {
  firm_id: string; case_id: string; ref: string; status: string; due_date: string | null;
  next_due_at: string; interval_hours: number; shared_update: string; template_name: string;
  template_language: string; phone: string; phone_number_id: string; access_token: string; dry_run: number;
};
export async function runSchedules(env: Env, fetcher: typeof fetch = fetch) {
  const start = now();
  const due = await env.DB.prepare(`SELECT r.*,c.ref,c.status,c.due_date,p.phone,s.phone_number_id,s.access_token,s.dry_run
    FROM whatsapp_rules r JOIN cases c ON c.id=r.case_id AND c.firm_id=r.firm_id
    JOIN whatsapp_contacts p ON p.agent_id=c.agent_id AND p.firm_id=c.firm_id
    JOIN whatsapp_settings s ON s.firm_id=r.firm_id
    WHERE r.enabled=1 AND r.next_due_at<=? AND c.status NOT IN ('completed','on_hold')
    AND p.enabled=1 AND p.consent=1 AND s.enabled=1 AND (s.access_token IS NOT NULL OR s.zernio_api_key IS NOT NULL) ORDER BY r.next_due_at LIMIT 10`).bind(start).all<Due>();
  for (const row of due.results) {
    const id = crypto.randomUUID();
    const next = new Date(Date.now() + row.interval_hours * 3600000).toISOString();
    // Atomic compare-and-set prevents overlapping scheduled invocations from sending twice.
    const claim = await env.DB.prepare("UPDATE whatsapp_rules SET next_due_at=? WHERE firm_id=? AND case_id=? AND next_due_at=? AND enabled=1 RETURNING case_id")
      .bind(next, row.firm_id, row.case_id, row.next_due_at).first();
    if (!claim) continue;
    const body = `${row.ref}: ${row.status.replaceAll("_"," ")}.${row.due_date ? ` Target date: ${row.due_date}.` : ""}${row.shared_update ? ` ${row.shared_update}` : ""}`;
    await env.DB.prepare("INSERT INTO whatsapp_messages(id,firm_id,case_id,phone,direction,body,status,idempotency_key,created_at,actor) VALUES(?,?,?,?,'outgoing',?,?,?,?, 'Scheduled follow-up')")
      .bind(id,row.firm_id,row.case_id,row.phone,body,row.dry_run ? "preview" : "sending",`schedule:${row.case_id}:${row.next_due_at}`,start).run();
    if (row.dry_run) continue;
    // Recheck consent and assignment after claiming, immediately before contacting the provider.
    const allowed = await env.DB.prepare(`SELECT c.id FROM cases c JOIN whatsapp_contacts p ON p.agent_id=c.agent_id AND p.firm_id=c.firm_id
      JOIN whatsapp_settings s ON s.firm_id=c.firm_id JOIN whatsapp_rules r ON r.case_id=c.id AND r.firm_id=c.firm_id
      WHERE c.id=? AND c.firm_id=? AND p.phone=? AND p.enabled=1 AND p.consent=1 AND s.enabled=1 AND s.dry_run=0 AND r.enabled=1 AND c.status NOT IN ('completed','on_hold')`)
      .bind(row.case_id,row.firm_id,row.phone).first();
    if (!allowed) {
      await env.DB.prepare("UPDATE whatsapp_messages SET status='blocked' WHERE id=?").bind(id).run();
      continue;
    }
    try {
      const settings = await env.DB.prepare("SELECT * FROM whatsapp_settings WHERE firm_id=?").bind(row.firm_id).first<Settings>();
      if (!settings?.enabled || settings.dry_run) {
        await env.DB.prepare("UPDATE whatsapp_messages SET status='blocked' WHERE id=?").bind(id).run();
        continue;
      }
      let conversationId: string | undefined;
      if (settings.provider==="zernio") conversationId=(await checkZernioRecipient(env,settings,row.phone,false)).conversationId;
      const sent = await sendProvider(env,settings,row.phone,body,`casetrack:${row.firm_id}:schedule:${row.case_id}:${row.next_due_at}`,
        {name:row.template_name,language:row.template_language,parameters:[body]},conversationId,fetcher);
      await env.DB.prepare("UPDATE whatsapp_messages SET status=?,provider_id=?,conversation_id=? WHERE id=?")
        .bind(sent.status,sent.providerId,sent.conversationId,id).run();
    } catch {
      await env.DB.prepare("UPDATE whatsapp_messages SET status='uncertain' WHERE id=?").bind(id).run();
    }
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM api_usage WHERE expires_at<?").bind(Date.now()),
    env.DB.prepare("DELETE FROM session WHERE expiresAt<?").bind(Date.now()),
    env.DB.prepare("DELETE FROM verification WHERE expiresAt<?").bind(Date.now()),
    env.DB.prepare("DELETE FROM rateLimit WHERE lastRequest<?").bind(Date.now() - 86400000),
    env.DB.prepare("DELETE FROM workspace_invites WHERE expires_at<?").bind(start),
  ]);
}
export default { scheduled: (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => { ctx.waitUntil(runSchedules(env)); } };
