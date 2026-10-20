// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../cloudflare/index";
import { digest, encrypt, now } from "../cloudflare/security";
import * as provider from "../cloudflare/whatsapp-provider";
import type { Env } from "../cloudflare/types";

class LocalD1 {
  sqlite = new DatabaseSync(":memory:");
  before?: (sql: string) => void;
  constructor() {
    for (const file of readdirSync("cloudflare/migrations").sort()) this.sqlite.exec(readFileSync(`cloudflare/migrations/${file}`, "utf8"));
  }
  prepare(sql: string) {
    let args: any[] = [];
    const execute = () => {
      this.before?.(sql);
      const results = this.sqlite.prepare(sql).all(...args);
      return { success: true, results, meta: { changes: Number(this.sqlite.prepare("SELECT changes() n").get()!.n) } };
    };
    const statement = {
      bind(...values: any[]) { args = values; return statement; },
      async first() { return execute().results[0] || null; },
      async all() { return execute(); }, async run() { return execute(); }, execute,
    };
    return statement;
  }
  async batch(statements: ReturnType<LocalD1["prepare"]>[]) {
    this.sqlite.exec("BEGIN");
    try { const results = statements.map(s => s.execute()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}
const opened: LocalD1[] = [];
afterEach(() => { opened.splice(0).forEach(db => db.sqlite.close()); vi.restoreAllMocks(); });
const keys = { a: `ct_${"1".repeat(64)}`, b: `ct_${"2".repeat(64)}` };
const secret = "synthetic-webhook-secret";
const prefix = "/whatsapp/assistant";
type Claim = { id: string; token: string; lease_until: string };

async function fixture() {
  const db = new LocalD1(); opened.push(db);
  const env = { DB: db, AUTH_SECRET: "synthetic-test-key-only-32-characters" } as unknown as Env;
  for (const f of ["a", "b"] as const) {
    db.sqlite.prepare('INSERT INTO "user"(id,name,email,createdAt,updatedAt) VALUES(?,?,?,0,0)').run(f, f, `${f}@example.test`);
    db.sqlite.prepare("INSERT INTO firms VALUES(?,?,?,?,'2026-01-01')").run(f, f, `${f}@example.test`, f);
    db.sqlite.prepare("INSERT INTO workspace_members VALUES(?,?,?,'owner','2026-01-01')").run(f, f, `${f}@example.test`);
    db.sqlite.prepare("INSERT INTO api_keys(id,firm_id,user_id,name,prefix,token_hash,scopes,created_at,expires_at) VALUES(?,?,?,?,?,?,?,'2026-01-01','2099-01-01')")
      .run(f, f, f, "Assistant test", "ct_test", await digest(keys[f]), '["assistant:reply"]');
    db.sqlite.prepare("INSERT INTO agents(id,firm_id,name,created_at) VALUES(?,?,?,'2026-01-01')").run(f, f, `Agent ${f}`);
    db.sqlite.prepare("INSERT INTO cases(id,firm_id,ref,buyer,type,status,priority,agent_id,notes,created_at,updated_at) VALUES(?,?,?,'PRIVATE BUYER','SPA','spa','normal',?,'PRIVATE NOTES','2026-01-01','2026-01-01')")
      .run(f, f, `REF-${f}`, f);
    db.sqlite.prepare("INSERT INTO whatsapp_contacts(firm_id,agent_id,phone,enabled,consent) VALUES(?,?,?,1,1)").run(f, f, "+60123456789");
    db.sqlite.prepare("INSERT INTO whatsapp_settings(firm_id,enabled,dry_run,updated_at,provider,zernio_account_id,zernio_api_key) VALUES(?,1,1,'2026-01-01','zernio',?,?)")
      .run(f, `account-${f}`, await encrypt(env, "test-provider-key"));
    db.sqlite.prepare("INSERT INTO reply_assistant_settings(firm_id,enabled,enabled_at,webhook_secret) VALUES(?,1,'2026-01-01',?)").run(f, await encrypt(env, secret));
  }
  db.sqlite.exec(`INSERT INTO agents(id,firm_id,name,created_at) VALUES('other','a','OTHER AGENT','2026-01-01');
    INSERT INTO cases(id,firm_id,ref,buyer,type,status,priority,agent_id,created_at,updated_at)
      VALUES('other','a','PRIVATE OTHER CASE','Private','SPA','spa','normal','other','2026-01-01','2026-01-01');
    INSERT INTO whatsapp_rules(firm_id,case_id,shared_update,next_due_at,template_name) VALUES('a','a','Signing ready','2099-01-01','test');`);
  const execution = { waitUntil: (_promise: Promise<unknown>) => {} } as ExecutionContext;
  async function request(path: string, method = "GET", body?: unknown, claim?: Claim, firm: "a" | "b" = "a") {
    return worker.fetch(new Request(`https://example.test/api/v1${path}`, {
      method, headers: { Authorization: `Bearer ${keys[firm]}`, "Content-Type": "application/json", ...(claim ? { "X-Job-Token": claim.token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env, execution);
  }
  const event = (id = crypto.randomUUID(), phone = "60123456789") => ({
    id: `event-${id}`, event: "message.received", timestamp: now(),
    account: { accountId: "account-a", platform: "whatsapp" }, conversation: { id: "conversation-a" },
    message: { id, conversationId: "conversation-a", platform: "whatsapp", direction: "incoming", text: "What are my cases?", sentAt: now(), sender: { id: phone } },
  });
  async function webhook(body: unknown, valid = true) {
    const raw = JSON.stringify(body);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw))), b => b.toString(16).padStart(2, "0")).join("");
    return worker.fetch(new Request("https://example.test/api/webhooks/zernio/a", {
      method: "POST", headers: { "X-Zernio-Signature": valid ? sig : "0".repeat(64) }, body: raw,
    }), env, execution);
  }
  async function claim() {
    const r = await request(`${prefix}/claim`, "POST", {});
    expect(r.status).toBe(200);
    return (await r.json() as { job: Claim | null }).job;
  }
  async function context(job: Claim) {
    const r = await request(`${prefix}/jobs/${job.id}`, "GET", undefined, job);
    expect(r.status).toBe(200);
    return r.json() as Promise<any>;
  }
  const count = (table: string) => db.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()!.n;
  return { db, env, request, event, webhook, claim, context, count };
}

describe("Muse reply assistant", () => {
  it("keeps idle polling local, denies general data and owner controls to its key", async () => {
    const f = await fixture(), fetcher = vi.spyOn(globalThis, "fetch");
    expect(await (await f.request(`${prefix}/poll`)).json()).toMatchObject({ action: "silent" });
    expect(fetcher).not.toHaveBeenCalled();
    for (const route of ["/cases", "/agents", "/whatsapp/messages", "/documents", "/workspace", `${prefix}/settings`]) {
      expect((await f.request(route)).status).toBe(403);
    }
  });
  it("verifies signatures and accepts legacy account id but rejects conflicting account IDs", async () => {
    const f = await fixture();
    expect((await f.webhook(f.event(), false)).status).toBe(403);
    const legacy: any = f.event(); legacy.account.id = legacy.account.accountId; delete legacy.account.accountId;
    expect((await f.webhook(legacy)).status).toBe(200);
    const wrong: any = f.event(); wrong.account.id = "account-b";
    await f.webhook(wrong);
    expect(f.count("reply_jobs")).toBe(1);
  });
  it("ignores unknown, hidden-identity, standby, test, disabled and cross-account senders", async () => {
    const f = await fixture();
    await f.webhook(f.event(undefined, "60199999999"));
    const hidden: any = f.event(); hidden.message.sender.businessScopedUserId = "60123456789"; await f.webhook(hidden);
    await f.webhook({ ...f.event(), metadata: { standby: true } });
    await f.webhook({ ...f.event(), test: true });
    const wrong = f.event(); wrong.account.accountId = "account-b"; await f.webhook(wrong);
    f.db.sqlite.exec("UPDATE whatsapp_contacts SET consent=0 WHERE firm_id='a'");
    await f.webhook(f.event());
    expect(f.count("reply_jobs")).toBe(0);
  });
  it("deduplicates retries, restricts case context and prevents another firm or token reading a claim", async () => {
    const f = await fixture(), e = f.event();
    await f.webhook(e); await f.webhook(e);
    expect(f.count("reply_jobs")).toBe(1);
    const job = (await f.claim())!;
    const ctx = await f.context(job);
    expect(ctx.cases).toHaveLength(1);
    expect(ctx.cases[0]).toMatchObject({ ref: "REF-a", shared_update: "Signing ready" });
    expect(JSON.stringify(ctx)).not.toMatch(/PRIVATE|OTHER AGENT|REF-b/);
    expect((await f.request(`${prefix}/jobs/${job.id}`, "GET", undefined, job, "b")).status).toBe(404);
    expect((await f.request(`${prefix}/jobs/${job.id}`, "GET", undefined, { ...job, token: "0".repeat(64) })).status).toBe(404);
  });
  it("claims one worker atomically, batches five questions maximum and safely reclaims an expired lease", async () => {
    const f = await fixture();
    for (let i = 0; i < 7; i++) await f.webhook(f.event());
    const jobs = await Promise.all([f.claim(), f.claim()]);
    expect(jobs.filter(Boolean)).toHaveLength(1);
    const job = jobs.find(Boolean)!;
    expect((await f.context(job)).questions).toHaveLength(5);
    f.db.sqlite.prepare("UPDATE reply_jobs SET lease_until='2000-01-01' WHERE id=?").run(job.id);
    const again = (await f.claim())!;
    expect(again.id).toBe(job.id);
    expect(again.token).not.toBe(job.token);
    expect((await f.context(again)).questions).toHaveLength(5);
    expect((await f.request(`${prefix}/jobs/${job.id}`, "GET", undefined, job)).status).toBe(404);
  });
  it("records exactly one preview and rejects a changed replay or a chosen recipient", async () => {
    const f = await fixture(); await f.webhook(f.event());
    const job = (await f.claim())!, ctx = await f.context(job);
    const route = `${prefix}/jobs/${job.id}/reply`, body = { body: "Your signing is ready.", context_version: ctx.context_version };
    expect((await f.request(route, "POST", { ...body, phone: "+60199999999" }, job)).status).toBe(400);
    const results = await Promise.all([f.request(route, "POST", body, job), f.request(route, "POST", body, job)]);
    expect(results.some(r => r.status === 200)).toBe(true);
    expect(await (await f.request(route, "POST", body, job)).json()).toMatchObject({ state: "replied", message: { status: "preview" } });
    expect((await f.request(route, "POST", { ...body, body: "Changed" }, job)).status).toBe(409);
    expect(f.db.sqlite.prepare("SELECT count(*) n FROM whatsapp_messages WHERE direction='outgoing'").get()!.n).toBe(1);
  });
  it("never batches two agents and releases a skipped job for the next sender", async () => {
    const f = await fixture();
    f.db.sqlite.exec("INSERT INTO whatsapp_contacts(firm_id,agent_id,phone,enabled,consent) VALUES('a','other','+60199999999',1,1)");
    await f.webhook(f.event());
    const other = f.event(undefined, "60199999999");
    other.message.conversationId = other.conversation.id = "other-conversation";
    await f.webhook(other);
    const job = (await f.claim())!, context = await f.context(job);
    expect(context.questions).toHaveLength(1);
    expect((await f.request(`${prefix}/jobs/${job.id}/heartbeat`, "POST", {}, job)).status).toBe(200);
    expect((await f.request(`${prefix}/jobs/${job.id}/skip`, "POST", {}, job)).status).toBe(200);
    const next = (await f.claim())!;
    expect((await f.context(next)).agent.id).not.toBe(context.agent.id);
  });
  it("invalidates old drafts after reassignment and rejects consent revoked during dispatch preparation", async () => {
    const f = await fixture(); await f.webhook(f.event());
    const job = (await f.claim())!, ctx = await f.context(job);
    f.db.sqlite.exec("UPDATE cases SET agent_id='other' WHERE id='a'");
    expect((await f.request(`${prefix}/jobs/${job.id}/reply`, "POST", { body: "Old answer", context_version: ctx.context_version }, job)).status).toBe(409);
    expect((await f.context(job)).cases).toHaveLength(0);
    f.db.sqlite.exec("UPDATE whatsapp_contacts SET consent=0 WHERE firm_id='a'");
    expect((await f.request(`${prefix}/jobs/${job.id}`, "GET", undefined, job)).status).toBe(403);
  });
  it("uses a revision compare-and-set to reject a change between projection and dispatch", async () => {
    const f = await fixture(); await f.webhook(f.event());
    const job = (await f.claim())!, ctx = await f.context(job);
    f.db.before = sql => {
      if (sql.startsWith("UPDATE reply_jobs SET state='sending'")) {
        f.db.before = undefined;
        f.db.sqlite.exec("UPDATE cases SET notes='changed during send',agent_id='other' WHERE id='a'");
      }
    };
    expect((await f.request(`${prefix}/jobs/${job.id}/reply`, "POST", { body: "Stale", context_version: ctx.context_version }, job)).status).toBe(409);
    expect(f.db.sqlite.prepare("SELECT count(*) n FROM whatsapp_messages WHERE direction='outgoing'").get()!.n).toBe(0);
  });
  it("honors a key revocation that happens during reply preparation", async () => {
    const f = await fixture(); await f.webhook(f.event());
    const job = (await f.claim())!, ctx = await f.context(job);
    f.db.before = sql => {
      if (sql.startsWith("UPDATE reply_jobs SET state='sending'")) {
        f.db.before = undefined;
        f.db.sqlite.exec("UPDATE api_keys SET revoked_at='2026-01-01' WHERE id='a'");
      }
    };
    expect((await f.request(`${prefix}/jobs/${job.id}/reply`, "POST", { body: "No send", context_version: ctx.context_version }, job)).status).toBe(409);
    expect(f.db.sqlite.prepare("SELECT count(*) n FROM whatsapp_messages WHERE direction='outgoing'").get()!.n).toBe(0);
  });
  it("honors STOP, daily caps, disabled connections, and API-key revocation", async () => {
    const f = await fixture(); await f.webhook(f.event());
    const job = (await f.claim())!, ctx = await f.context(job);
    const stop = f.event(); stop.message.text = "STOP"; await f.webhook(stop);
    expect((await f.request(`${prefix}/jobs/${job.id}/reply`, "POST", { body: "No", context_version: ctx.context_version }, job)).status).toBe(403);
    f.db.sqlite.exec("UPDATE whatsapp_contacts SET enabled=1,consent=1 WHERE firm_id='a'");
    const fresh = await f.context(job);
    await f.request(`${prefix}/jobs/${job.id}/reply`, "POST", { body: "Preview", context_version: fresh.context_version }, job);
    f.db.sqlite.exec("UPDATE reply_assistant_settings SET daily_limit=1 WHERE firm_id='a'");
    await f.webhook(f.event());
    expect(await (await f.request(`${prefix}/poll`)).json()).toMatchObject({ action: "silent" });
    f.db.sqlite.exec("UPDATE whatsapp_settings SET enabled=0 WHERE firm_id='a'");
    expect(f.db.sqlite.prepare("SELECT enabled FROM reply_assistant_settings WHERE firm_id='a'").get()!.enabled).toBe(0);
    f.db.sqlite.exec("UPDATE api_keys SET revoked_at='2026-01-01' WHERE id='a'");
    expect((await f.request(`${prefix}/poll`)).status).toBe(401);
  });
  it("never automatically retries ambiguous sends and releases an interrupted sending lock", async () => {
    const f = await fixture(); await f.webhook(f.event());
    f.db.sqlite.exec("UPDATE whatsapp_settings SET dry_run=0 WHERE firm_id='a'");
    vi.spyOn(provider, "checkZernioRecipient").mockResolvedValue({ conversationId: "conversation-a" } as any);
    const send = vi.spyOn(provider, "sendProvider").mockResolvedValue({ status: "uncertain", providerId: null, conversationId: "conversation-a" });
    const job = (await f.claim())!, ctx = await f.context(job), body = { body: "Answer", context_version: ctx.context_version };
    expect(await (await f.request(`${prefix}/jobs/${job.id}/reply`, "POST", body, job)).json()).toMatchObject({ state: "held" });
    await f.request(`${prefix}/jobs/${job.id}/reply`, "POST", body, job);
    expect(send).toHaveBeenCalledTimes(1);
    f.db.sqlite.prepare("UPDATE reply_jobs SET state='sending',lease_until='2000-01-01' WHERE id=?").run(job.id);
    await f.webhook(f.event());
    expect(await f.claim()).not.toBeNull();
    expect(f.db.sqlite.prepare("SELECT state FROM reply_jobs WHERE id=?").get(job.id)!.state).toBe("held");
  });
  it("reconciles a delivery receipt that arrives before the send response", async () => {
    const f = await fixture(); await f.webhook(f.event());
    f.db.sqlite.exec("UPDATE whatsapp_settings SET dry_run=0 WHERE firm_id='a'");
    vi.spyOn(provider, "checkZernioRecipient").mockResolvedValue({ conversationId: "conversation-a" } as any);
    vi.spyOn(provider, "sendProvider").mockImplementation(async () => {
      await f.webhook({ event: "message.delivered", account: { id: "account-a", platform: "whatsapp" }, message: { id: "provider-out" } });
      return { status: "accepted", providerId: "provider-out", conversationId: "conversation-a" };
    });
    const job = (await f.claim())!, ctx = await f.context(job);
    await f.request(`${prefix}/jobs/${job.id}/reply`, "POST", { body: "Answer", context_version: ctx.context_version }, job);
    expect(await (await f.request(`${prefix}/jobs/${job.id}/status`, "GET", undefined, job)).json()).toMatchObject({ delivery_status: "delivered" });
  });
  it("does not replay old messages when enabled, nor leave failed processing attempts blocking others", async () => {
    const f = await fixture();
    const old = f.event(); old.message.sentAt = "2026-01-01T00:00:00Z"; await f.webhook(old);
    expect(f.count("reply_jobs")).toBe(0);
    await f.webhook(f.event());
    const job = (await f.claim())!;
    f.db.sqlite.prepare("UPDATE reply_jobs SET attempts=3,lease_until='2000-01-01' WHERE id=?").run(job.id);
    await f.webhook(f.event());
    expect((await f.claim())!.id).not.toBe(job.id);
    expect(f.db.sqlite.prepare("SELECT state FROM reply_jobs WHERE id=?").get(job.id)!.state).toBe("held");
  });
});
