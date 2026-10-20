import type { Hono } from "hono";
import { z } from "zod";
import type { Env, Identity } from "./types";
import { audit, belongs, firm, identity, owner, scope } from "./index";
import { decrypt, digest, encrypt, fail, now, token } from "./security";

import { ZernioClient } from "./zernio";
import { zernio, syncMessages, checkZernioRecipient, sendProvider, type Settings } from "./whatsapp-provider";
export function whatsappRoutes(app: Hono<{ Bindings: Env; Variables: { identity: Identity } }>) {
  app.get("/api/v1/whatsapp/rules", async c => {
    scope(c,"whatsapp:read");
    return c.json((await c.env.DB.prepare("SELECT * FROM whatsapp_rules WHERE firm_id=?").bind(firm(c)).all()).results);
  });
  app.put("/api/v1/whatsapp/rules/:id", async c => {
    scope(c,"whatsapp:write");
    if (!identity(c).keyId) owner(c);
    await belongs(c,"cases",c.req.param("id"));
    const b = z.object({
      enabled:z.boolean(), interval_hours:z.number().int().min(24).max(2160),
      next_due_at:z.iso.datetime(), shared_update:z.string().max(800),
      template_name:z.string().regex(/^[a-z0-9_]{1,512}$/), template_language:z.string().regex(/^[a-z]{2}(?:_[A-Z]{2})?$/),
    }).parse(await c.req.json());
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO whatsapp_rules(firm_id,case_id,enabled,interval_hours,next_due_at,shared_update,template_name,template_language)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(firm_id,case_id) DO UPDATE SET enabled=excluded.enabled,interval_hours=excluded.interval_hours,
        next_due_at=excluded.next_due_at,shared_update=excluded.shared_update,template_name=excluded.template_name,template_language=excluded.template_language`)
        .bind(firm(c),c.req.param("id"),Number(b.enabled),b.interval_hours,b.next_due_at,b.shared_update,b.template_name,b.template_language),
      audit(c,"WhatsApp follow-up rule updated",b.enabled ? "Enabled" : "Paused","case",c.req.param("id")),
    ]);
    return c.json({success:true});
  });
  app.get("/api/v1/whatsapp/settings", async c => {
    const f = owner(c);
    const settings = await c.env.DB.prepare("SELECT provider,phone_number_id,enabled,dry_run,access_token IS NOT NULL AS has_token,app_secret IS NOT NULL AS has_secret,zernio_account_id,zernio_api_key IS NOT NULL AS has_zernio_key,account_label FROM whatsapp_settings WHERE firm_id=?").bind(f).first();
    const contacts = await c.env.DB.prepare("SELECT agent_id,phone,enabled,consent FROM whatsapp_contacts WHERE firm_id=?").bind(f).all();
    return c.json({ settings: settings || { provider:"meta", phone_number_id: "", enabled: 0, dry_run: 1, has_token: false, has_secret: false, has_zernio_key:false, zernio_account_id:"", account_label:"" }, contacts: contacts.results, webhook: `${new URL(c.req.url).origin}/api/webhooks/whatsapp/${f}` });
  });
  app.put("/api/v1/whatsapp/settings", async c => {
    const f = owner(c);
    const input = await c.req.json();
    const old = await c.env.DB.prepare("SELECT * FROM whatsapp_settings WHERE firm_id=?").bind(f).first<Settings>();
    if (input.provider === "zernio") {
      const b = z.object({zernio_account_id:z.string().regex(/^[a-zA-Z0-9_-]{5,100}$/),
        zernio_api_key:z.string().min(10).max(4096).optional(), enabled:z.boolean(),dry_run:z.boolean()}).parse(input);
      const secret = b.zernio_api_key ? await encrypt(c.env,b.zernio_api_key) : old?.zernio_api_key;
      if (!secret) fail(400,"Add your Zernio API key first.");
      const plainKey = await decrypt(c.env,secret);
      let account: {label:string;phone:string};
      try { account = await new ZernioClient(plainKey,b.zernio_account_id).verify(); }
      catch(error) {
        console.error("Zernio connection verification",String(error).replaceAll(plainKey,"[REDACTED]"));
        throw error;
      }
      const statements = [c.env.DB.prepare(`INSERT INTO whatsapp_settings(firm_id,provider,phone_number_id,enabled,dry_run,zernio_account_id,zernio_api_key,account_label,updated_at)
        VALUES(?,'zernio',?,?,?,?,?,?,?) ON CONFLICT(firm_id) DO UPDATE SET provider='zernio',phone_number_id=excluded.phone_number_id,
        enabled=excluded.enabled,dry_run=excluded.dry_run,zernio_account_id=excluded.zernio_account_id,zernio_api_key=excluded.zernio_api_key,
        account_label=excluded.account_label,access_token=NULL,app_secret=NULL,verify_token_hash=NULL,updated_at=excluded.updated_at`)
        .bind(f,account.phone,Number(b.enabled),Number(b.dry_run),b.zernio_account_id,secret,account.label,now())];
      if (old?.provider !== "zernio" || old.zernio_account_id !== b.zernio_account_id)
        statements.push(c.env.DB.prepare("UPDATE whatsapp_rules SET enabled=0 WHERE firm_id=?").bind(f));
      await c.env.DB.batch(statements);
      return c.json({success:true});
    }
    const b = z.object({
      phone_number_id: z.string().regex(/^\d{5,30}$/), access_token: z.string().max(4096).optional(),
      app_secret: z.string().max(256).optional(), enabled: z.boolean(), dry_run: z.boolean(),
    }).parse(input);
    const access = b.access_token ? await encrypt(c.env, b.access_token) : old?.access_token;
    const secret = b.app_secret ? await encrypt(c.env, b.app_secret) : old?.app_secret;
    if (b.enabled && (!access || !secret)) fail(400, "Add your WhatsApp access token and Meta app secret first.");
    const verify = token();
    await c.env.DB.prepare(`INSERT INTO whatsapp_settings(firm_id,phone_number_id,access_token,app_secret,verify_token_hash,enabled,dry_run,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(firm_id) DO UPDATE SET phone_number_id=excluded.phone_number_id,access_token=excluded.access_token,
      app_secret=excluded.app_secret,verify_token_hash=excluded.verify_token_hash,enabled=excluded.enabled,dry_run=excluded.dry_run,updated_at=excluded.updated_at,
      provider='meta',zernio_account_id=NULL,zernio_api_key=NULL,account_label=''`)
      .bind(f, b.phone_number_id, access || null, secret || null, old?.verify_token_hash || await digest(verify), Number(b.enabled), Number(b.dry_run), now()).run();
    if (old?.provider === "zernio") await c.env.DB.prepare("UPDATE whatsapp_rules SET enabled=0 WHERE firm_id=?").bind(f).run();
    return c.json({ success: true, ...(old?.verify_token_hash ? {} : { verifyToken: verify }) });
  });
  app.post("/api/v1/whatsapp/verification-token", async c => {
    const f = owner(c), value = token();
    const result = await c.env.DB.prepare("UPDATE whatsapp_settings SET verify_token_hash=? WHERE firm_id=?").bind(await digest(value), f).run();
    if (!result.meta.changes) fail(400, "Save WhatsApp settings first.");
    return c.json({ verifyToken: value });
  });
  app.put("/api/v1/whatsapp/contacts/:id", async c => {
    owner(c); await belongs(c, "agents", c.req.param("id"));
    const b = z.object({ phone: z.string().regex(/^\+[1-9]\d{7,14}$/), enabled: z.boolean(), consent: z.boolean() }).parse(await c.req.json());
    await c.env.DB.prepare("INSERT INTO whatsapp_contacts(firm_id,agent_id,phone,enabled,consent,consent_updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(firm_id,agent_id) DO UPDATE SET phone=excluded.phone,enabled=excluded.enabled,consent=excluded.consent,consent_updated_at=excluded.consent_updated_at")
      .bind(firm(c), c.req.param("id"), b.phone, Number(b.enabled), Number(b.consent),now()).run();
    return c.json({ success: true });
  });
  app.get("/api/v1/whatsapp/connection", async c => {
    scope(c,"whatsapp:read");
    return c.json(await c.env.DB.prepare("SELECT provider,phone_number_id,enabled,dry_run,account_label FROM whatsapp_settings WHERE firm_id=?").bind(firm(c)).first()
      || {provider:"meta",enabled:0,dry_run:1,phone_number_id:"",account_label:""});
  });
  app.get("/api/v1/whatsapp/contacts", async c => {
    scope(c,"whatsapp:read");
    return c.json((await c.env.DB.prepare("SELECT agent_id,phone,enabled,consent FROM whatsapp_contacts WHERE firm_id=?").bind(firm(c)).all()).results);
  });
  app.get("/api/v1/whatsapp/conversations", async c => {
    scope(c,"whatsapp:read");
    const settings = await c.env.DB.prepare("SELECT * FROM whatsapp_settings WHERE firm_id=?").bind(firm(c)).first<Settings>();
    if (!settings) fail(400,"Connect a Zernio WhatsApp account first.");
    const cursor=z.string().max(4096).parse(c.req.query("cursor")||"");
    const limit=z.coerce.number().int().min(1).max(100).parse(c.req.query("limit")||50);
    return c.json(await (await zernio(c.env,settings)).conversations(cursor,limit));
  });
  app.get("/api/v1/whatsapp/conversations/:id/messages", async c => {
    scope(c,"whatsapp:read");
    const settings = await c.env.DB.prepare("SELECT * FROM whatsapp_settings WHERE firm_id=?").bind(firm(c)).first<Settings>();
    if (!settings) fail(400,"Connect a Zernio WhatsApp account first.");
    const id=z.string().min(1).max(512).parse(c.req.param("id"));
    const cursor=z.string().max(4096).parse(c.req.query("cursor")||"");
    const limit=z.coerce.number().int().min(1).max(100).parse(c.req.query("limit")||50);
    const result=await (await zernio(c.env,settings)).messages(id,cursor,limit);
    await syncMessages(c.env,firm(c),result.conversation,result.data);
    return c.json(result);
  });
  app.get("/api/v1/whatsapp/messages", async c => {
    scope(c, "whatsapp:read");
    const rows = await c.env.DB.prepare("SELECT * FROM whatsapp_messages WHERE firm_id=? AND id>? ORDER BY id LIMIT 101").bind(firm(c), c.req.query("cursor") || "").all();
    const data = rows.results.slice(0, 100);
    return c.json({ data, nextCursor: rows.results.length > 100 ? data.at(-1)?.id : null });
  });
  app.post("/api/v1/whatsapp/messages", async c => {
    scope(c, "whatsapp:write");
    const f = firm(c);
    const b = z.object({
      phone: z.string().regex(/^\+[1-9]\d{7,14}$/), body: z.string().trim().min(1).max(4096),
      case_id: z.uuid().nullable().default(null),
      template: z.object({ name: z.string().regex(/^[a-z0-9_]{1,512}$/), language: z.string().regex(/^[a-z]{2}(?:_[A-Z]{2})?$/), parameters: z.array(z.string().max(1024)).max(10).default([]) }).optional(),
    }).parse(await c.req.json());
    if (b.case_id) await belongs(c, "cases", b.case_id);
    const idempotency = z.string().min(8).max(128).parse(c.req.header("idempotency-key"));
    const requestHash = await digest(JSON.stringify(b));
    const prior = await c.env.DB.prepare("SELECT id,status,request_hash FROM whatsapp_messages WHERE firm_id=? AND idempotency_key=?").bind(f, idempotency).first();
    if (prior) {
      if (prior.request_hash && prior.request_hash !== requestHash) fail(409, "This idempotency key was already used for a different message.");
      return c.json({ id: prior.id, status: prior.status });
    }
    if (idempotency.startsWith("schedule:")) fail(400, "Idempotency keys starting with schedule: are reserved for scheduled updates.");
    const contact = await c.env.DB.prepare("SELECT agent_id FROM whatsapp_contacts WHERE firm_id=? AND phone=? AND enabled=1 AND consent=1").bind(f, b.phone).first<{ agent_id: string }>();
    if (!contact) fail(403, "Recipient must be verified and have messaging consent.");
    if (b.case_id && !await c.env.DB.prepare("SELECT id FROM cases WHERE id=? AND firm_id=? AND agent_id=?").bind(b.case_id, f, contact.agent_id).first()) fail(403, "The recipient is not assigned to this case.");
    const settings = await c.env.DB.prepare("SELECT * FROM whatsapp_settings WHERE firm_id=?").bind(f).first<Settings>();
    if (!settings?.enabled) fail(400, "WhatsApp integration is paused.");
    let conversationId: string | undefined;
    if (!settings.dry_run && settings.provider === "zernio") {
      conversationId=(await checkZernioRecipient(c.env,settings,b.phone,!b.template)).conversationId;
    }
    if (!settings.dry_run && settings.provider !== "zernio" && !b.template) {
      const last = await c.env.DB.prepare("SELECT created_at FROM whatsapp_messages WHERE firm_id=? AND phone=? AND direction='incoming' ORDER BY created_at DESC LIMIT 1").bind(f, b.phone).first<{ created_at: string }>();
      if (!last || Date.now() - Date.parse(last.created_at) > 23 * 3600000) fail(400, "An approved WhatsApp template is required outside the reply window.");
    }
    const id = crypto.randomUUID(), status = settings.dry_run ? "preview" : "sending";
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO whatsapp_messages(id,firm_id,case_id,phone,direction,body,status,idempotency_key,created_at,actor,request_hash) VALUES(?,?,?,?,'outgoing',?,?,?,?,?,?)")
        .bind(id, f, b.case_id, b.phone, b.body, status, idempotency, now(), identity(c).email, requestHash),
      audit(c, "WhatsApp message prepared", `${b.phone}: ${status}`, "case", b.case_id),
    ]);
    if (settings.dry_run) return c.json({ id, status }, 201);
    const sent = await sendProvider(c.env,settings,b.phone,b.body,`casetrack:${f}:${idempotency}`,b.template,conversationId);
    await c.env.DB.prepare("UPDATE whatsapp_messages SET status=?,provider_id=?,conversation_id=? WHERE id=? AND firm_id=?")
      .bind(sent.status,sent.providerId,sent.conversationId,id,f).run();
    return c.json({ id, status: sent.status }, 201);
  });
  app.get("/api/webhooks/whatsapp/:firm", async c => {
    const s = await c.env.DB.prepare("SELECT verify_token_hash FROM whatsapp_settings WHERE firm_id=?").bind(c.req.param("firm")).first<{ verify_token_hash: string }>();
    if (c.req.query("hub.mode") !== "subscribe" || !s || await digest(c.req.query("hub.verify_token") || "") !== s.verify_token_hash) fail(403, "Invalid verification.");
    return c.text(c.req.query("hub.challenge") || "");
  });
  app.post("/api/webhooks/whatsapp/:firm", async c => {
    const f = c.req.param("firm");
    const s = await c.env.DB.prepare("SELECT * FROM whatsapp_settings WHERE firm_id=?").bind(f).first<Settings>();
    if (!s?.app_secret) fail(404, "Integration not found.");
    const raw = await c.req.text();
    if (raw.length > 1048576) fail(413, "Payload too large.");
    const signature = c.req.header("x-hub-signature-256") || "";
    if (!/^sha256=[a-f0-9]{64}$/.test(signature)) fail(403, "Invalid signature.");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(await decrypt(c.env, s.app_secret)), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const bytes = Uint8Array.from(signature.slice(7).match(/.{2}/g)!, h => parseInt(h, 16));
    if (!await crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(raw))) fail(403, "Invalid signature.");
    const payload = JSON.parse(raw) as { entry?: { changes?: { value?: { metadata?: { phone_number_id: string }; messages?: { id: string; from: string; timestamp: string; text?: { body: string }; type: string }[]; statuses?: { id: string; status: string }[] } }[] }[] };
    for (const entry of payload.entry || []) for (const change of entry.changes || []) {
      const v = change.value;
      if (v?.metadata?.phone_number_id !== s.phone_number_id) continue;
      for (const message of (v.messages || []).slice(0, 100)) {
        if (!/^\d{8,15}$/.test(message.from)) continue;
        const phone = `+${message.from}`, body = (message.text?.body || `[${message.type} message]`).slice(0, 4096);
        const timestamp = Number(message.timestamp) * 1000;
        if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > Date.now() + 60000) continue;
        await c.env.DB.prepare("INSERT OR IGNORE INTO whatsapp_messages(id,firm_id,phone,direction,body,status,provider_id,created_at,actor) VALUES(?,?,?,'incoming',?,'received',?,?,?)")
          .bind(crypto.randomUUID(), f, phone, body, message.id, new Date(timestamp).toISOString(), phone).run();
        if (/^(stop|unsubscribe|cancel)$/i.test(body.trim())) await c.env.DB.prepare("UPDATE whatsapp_contacts SET consent=0,enabled=0 WHERE firm_id=? AND phone=?").bind(f, phone).run();
      }
      for (const status of (v.statuses || []).slice(0, 100)) {
        // Provider callbacks can arrive late or out of order; delivery/read must not regress.
        const predecessors: Record<string, string[]> = {
          sent: ["sending", "uncertain", "accepted"],
          delivered: ["sending", "uncertain", "accepted", "sent", "failed"],
          read: ["sending", "uncertain", "accepted", "sent", "delivered", "failed"],
          failed: ["sending", "uncertain", "accepted", "sent"],
        };
        const allowed = predecessors[status.status];
        if (allowed) await c.env.DB.prepare(`UPDATE whatsapp_messages SET status=? WHERE firm_id=? AND provider_id=? AND direction='outgoing' AND status IN (${allowed.map(() => "?").join(",")})`).bind(status.status, f, status.id, ...allowed).run();
      }
    }
    return c.json({ received: true });
  });
}
