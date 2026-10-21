// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../cloudflare/index";
import { digest, encrypt, now } from "../cloudflare/security";
import * as provider from "../cloudflare/whatsapp-provider";
import * as authentication from "../cloudflare/auth";
import { stageTemplates } from "../cloudflare/muse-followups";
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

async function stageFixture() {
  const f = await fixture();
  f.db.sqlite.exec(`INSERT INTO muse_followup_settings(firm_id,enabled,template_name,template_language,updated_at) VALUES('a',1,'case_stage','en','2026-01-01');
    INSERT INTO muse_stage_rules VALUES('a','a','stamping',1,'REF-a has reached Stamping and transfer.','2026-01-01');`);
  const enter = () => f.db.sqlite.exec("UPDATE cases SET status='stamping' WHERE id='a'");
  async function claimStage() {
    const response = await f.request(`${prefix}/claim`, "POST", { include_followups: true });
    expect(response.status).toBe(200);
    return (await response.json() as any).job as Claim;
  }
  return { ...f, enter, claimStage };
}

describe("Muse case-stage follow-ups", () => {
  it("queues only configured transitions atomically, once per case stage, and never on a repeated save", async () => {
    const f = await stageFixture();
    expect(f.count("reply_jobs")).toBe(0);
    f.db.sqlite.exec("UPDATE cases SET status='loan' WHERE id='a'");
    expect(f.count("reply_jobs")).toBe(0);
    f.db.sqlite.exec("BEGIN"); f.enter(); expect(f.count("reply_jobs")).toBe(1); f.db.sqlite.exec("ROLLBACK");
    expect(f.count("reply_jobs")).toBe(0);
    f.enter(); f.enter();
    expect(f.count("reply_jobs")).toBe(1);
    f.db.sqlite.exec("UPDATE cases SET status='loan' WHERE id='a'"); f.enter();
    expect(f.count("reply_jobs")).toBe(1);
    expect(f.db.sqlite.prepare("SELECT state FROM reply_jobs").get()!.state).toBe("skipped");
  });
  it("does not queue while opted out, disabled, unassigned or not connected", async () => {
    for (const mutation of ["UPDATE whatsapp_contacts SET consent=0", "UPDATE muse_stage_rules SET enabled=0", "UPDATE muse_followup_settings SET enabled=0",
      "UPDATE reply_assistant_settings SET enabled=0", "UPDATE cases SET agent_id=NULL", "UPDATE whatsapp_settings SET enabled=0"]) {
      const f = await stageFixture(); f.db.sqlite.exec(mutation); f.enter();
      expect(f.count("reply_jobs"), mutation).toBe(0);
    }
  });
  it("keeps old helpers reply-only and polling local, with one shared worker lock and no cross-kind batching", async () => {
    const f = await stageFixture(), fetcher = vi.spyOn(globalThis, "fetch"); f.enter();
    expect(await (await f.request(`${prefix}/poll`)).json()).toMatchObject({ action: "silent" });
    expect(await f.claim()).toBeNull();
    expect(await (await f.request(`${prefix}/poll?followups=1`)).json()).toMatchObject({ action: "wake" });
    expect(fetcher).not.toHaveBeenCalled();
    await f.webhook(f.event());
    const incoming = await f.claimStage();
    expect((await f.context(incoming)).kind).toBe("reply");
    expect(await f.claimStage()).toBeNull();
    await f.request(`${prefix}/jobs/${incoming.id}/skip`, "POST", {}, incoming);
    const stage = await f.claimStage();
    expect((await f.context(stage)).kind).toBe("followup");
    expect(f.db.sqlite.prepare("SELECT count(*) n FROM reply_jobs WHERE state='batched'").get()!.n).toBe(0);
  });
  it("restricts context to the chosen case message, pins the recipient, and deduplicates identical submissions", async () => {
    const f = await stageFixture(); f.enter();
    const job = await f.claimStage(), ctx = await f.context(job);
    expect(ctx.notification).toEqual({ id: "a", ref: "REF-a", status: "stamping", approved_message: "REF-a has reached Stamping and transfer." });
    expect(ctx.cases).toBeUndefined(); expect(ctx.questions).toBeUndefined();
    expect(JSON.stringify(ctx)).not.toMatch(/PRIVATE|OTHER AGENT|REF-b/);
    expect((await f.request(`${prefix}/jobs/${job.id}`, "GET", undefined, job, "b")).status).toBe(404);
    const draft = { body: ctx.notification.approved_message, context_version: ctx.context_version };
    expect((await f.request(`${prefix}/jobs/${job.id}/reply`, "POST", { ...draft, phone: "+60199999999" }, job)).status).toBe(400);
    for (let i = 0; i < 2; i++) expect((await f.request(`${prefix}/jobs/${job.id}/reply`, "POST", draft, job)).status).toBe(200);
    expect(f.count("whatsapp_messages")).toBe(1);
    expect(f.db.sqlite.prepare("SELECT phone,actor FROM whatsapp_messages").get()).toMatchObject({ phone: "+60123456789", actor: "Muse stage notification" });
  });
  it("cancels or invalidates drafts on stage, assignment, consent, rule and settings changes", async () => {
    for (const mutation of ["UPDATE cases SET status='completed' WHERE id='a'", "UPDATE cases SET agent_id='other' WHERE id='a'",
      "UPDATE whatsapp_contacts SET consent=0", "UPDATE muse_stage_rules SET enabled=0", "UPDATE muse_followup_settings SET enabled=0",
      "UPDATE muse_stage_rules SET message='A revised approved message'"]) {
      const f = await stageFixture(); f.enter(); const job = await f.claimStage(), ctx = await f.context(job);
      f.db.sqlite.exec(mutation);
      const response = await f.request(`${prefix}/jobs/${job.id}/reply`, "POST", { body: "Old draft", context_version: ctx.context_version }, job);
      expect([403, 409], mutation).toContain(response.status); expect(f.count("whatsapp_messages")).toBe(0);
    }
  });
  it("refuses a stale draft when the rule changes between context validation and dispatch", async () => {
    const f = await stageFixture(); f.enter(); const job = await f.claimStage(), ctx = await f.context(job);
    f.db.before = sql => { if (sql.includes("state='sending',reply_body")) { f.db.before = undefined; f.db.sqlite.exec("UPDATE muse_stage_rules SET enabled=0"); } };
    expect((await f.request(`${prefix}/jobs/${job.id}/reply`, "POST", { body: "Draft", context_version: ctx.context_version }, job)).status).toBe(409);
    expect(f.count("whatsapp_messages")).toBe(0);
  });
  it("enforces expiry and the shared daily allowance", async () => {
    const f = await stageFixture(); f.enter();
    f.db.sqlite.exec("UPDATE reply_jobs SET expires_at='2000-01-01'");
    expect(await f.claimStage()).toBeNull();
    expect(f.db.sqlite.prepare("SELECT state,review_reason FROM reply_jobs").get()).toMatchObject({ state: "held", review_reason: "Stage notification expired" });
    const g = await stageFixture(); g.enter(); const job = await g.claimStage(), ctx = await g.context(job);
    g.db.sqlite.exec("UPDATE reply_assistant_settings SET daily_limit=1 WHERE firm_id='a'");
    await g.request(`${prefix}/jobs/${job.id}/reply`, "POST", { body: "Draft", context_version: ctx.context_version }, job);
    await g.webhook(g.event()); expect(await g.claim()).toBeNull();
  });
  it("uses the configured approved template outside the window and holds without one", async () => {
    for (const approved of [true, false]) {
      const f = await stageFixture(); f.db.sqlite.exec("UPDATE whatsapp_settings SET dry_run=0 WHERE firm_id='a'"); f.enter();
      const job = await f.claimStage(), ctx = await f.context(job);
      const template = { name: "case_stage", language: "en", status: approved ? "APPROVED" : "PENDING", components: [{ type: "BODY", text: "CaseTrack update: {{1}}. Reply for help." }] };
      vi.spyOn(provider, "checkZernioRecipient").mockResolvedValue({ conversationId: "verified-conversation", replyWindowOpen: false, client: {} } as any);
      vi.spyOn(provider, "zernio").mockResolvedValue({ request: async () => ({ templates: [template] }) } as any);
      const send = vi.spyOn(provider, "sendProvider").mockResolvedValue({ status: "accepted", providerId: "stage-message", conversationId: "verified-conversation" });
      const response = await f.request(`${prefix}/jobs/${job.id}/reply`, "POST", { body: "Case reached stamping.", context_version: ctx.context_version }, job);
      if (approved) {
        expect(response.status).toBe(200);
        expect(send).toHaveBeenCalledWith(f.env, expect.anything(), "+60123456789", "Case reached stamping.", expect.any(String), { name: "case_stage", language: "en", parameters: ["Case reached stamping."] }, "verified-conversation");
      } else {
        expect(response.status).toBe(409); expect(send).not.toHaveBeenCalled();
        expect(f.db.sqlite.prepare("SELECT state,review_reason FROM reply_jobs").get()).toMatchObject({ state: "held", review_reason: expect.stringContaining("template") });
      }
      vi.restoreAllMocks();
    }
  });
  it("filters unsupported template components and variables", async () => {
    const f = await stageFixture();
    const template = { name: "valid", language: "en", status: "APPROVED", components: [{ type: "BODY", text: "Update: {{1}}." }] };
    vi.spyOn(provider, "zernio").mockResolvedValue({ request: async () => ({ templates: [template,
      { ...template, name: "media", components: [...template.components, { type: "HEADER", format: "DOCUMENT" }] },
      { ...template, name: "two", components: [{ type: "BODY", text: "{{1}} {{2}}" }] }] }) } as any);
    expect((await stageTemplates(f.env, { firm_id: "a" } as any)).map(t => t.name)).toEqual(["valid"]);
  });
  it("lets signed-in clerks configure their cases but never the assistant key or another firm", async () => {
    const f = await stageFixture();
    f.db.sqlite.exec("UPDATE workspace_members SET role='member' WHERE user_id='a'");
    vi.spyOn(authentication, "auth").mockReturnValue({ api: { getSession: async () => ({ user: { id: "a", email: "a@example.test" } }) } } as any);
    const staff = (path: string, method = "GET", body?: unknown) => worker.fetch(new Request(`https://example.test/api/v1${path}`, {
      method, headers: { Origin: "https://example.test", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), f.env, { waitUntil: () => {} } as any);
    const rules = ["documents", "spa", "loan", "redemption", "stamping", "disbursement", "completed", "on_hold"].map(stage => ({ stage, enabled: stage === "stamping", message: `Approved ${stage} notice` }));
    expect((await staff("/cases/a/stage-notifications", "PUT", { rules })).status).toBe(200);
    expect((await staff("/cases/b/stage-notifications", "PUT", { rules })).status).toBe(404);
    expect((await f.request("/cases/a/stage-notifications", "PUT", { rules })).status).toBe(403);
    expect((await staff(`${prefix}/followups/settings`, "PUT", { enabled: true, template_name: "", template_language: "en" })).status).toBe(403);
    expect(f.count("reply_jobs")).toBe(0); // Saving switches alone never sends.
  });
});

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
  it.each(["internal-thread", "60123456789"])("resolves the webhook conversation directly and sends to its verified API ID (%s)", async returnedId => {
    const f = await fixture();
    const incoming = f.event();
    incoming.conversation.id = incoming.message.conversationId = "internal-thread";
    f.db.sqlite.exec("UPDATE whatsapp_settings SET dry_run=0 WHERE firm_id='a'");
    await f.webhook(incoming);
    const job = (await f.claim())!, ctx = await f.context(job);
    const conversation = { id: returnedId, accountId: "account-a", platform: "whatsapp", participantId: "60123456789" };
    const requests: { path: string; method: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input)), method = init?.method || "GET";
      requests.push({ path: url.pathname, method });
      expect(url.searchParams.get("accountId")).toBe("account-a");
      if (url.pathname.endsWith("/search")) throw Error("A job must resolve its own conversation, never search for a replacement");
      if (method === "POST") {
        expect(url.pathname).toBe(`/api/v1/inbox/conversations/${returnedId}/messages`);
        expect(JSON.parse(String(init?.body))).toMatchObject({ accountId: "account-a", message: "Your case is at SPA." });
        return Response.json({ success: true, data: { messageId: "outgoing-provider-id", conversationId: returnedId } });
      }
      if (url.pathname.endsWith("/messages")) return Response.json({ messages: [{
        id: incoming.message.id, accountId: "account-a", platform: "whatsapp", direction: "incoming", message: incoming.message.text, createdAt: incoming.message.sentAt,
      }], pagination: { hasMore: false } });
      return Response.json({ data: conversation });
    });
    const body = { body: "Your case is at SPA.", context_version: ctx.context_version };
    const r = await f.request(`${prefix}/jobs/${job.id}/reply`, "POST", body, job);
    expect(await r.json()).toMatchObject({ state: "replied", message: { status: "accepted" } });
    expect(requests[0].path).toBe("/api/v1/inbox/conversations/internal-thread");
    await f.request(`${prefix}/jobs/${job.id}/reply`, "POST", body, job);
    expect(requests.filter(r => r.method === "POST")).toHaveLength(1);
    expect(f.db.sqlite.prepare("SELECT conversation_id FROM whatsapp_messages WHERE direction='outgoing'").get()!.conversation_id).toBe(returnedId);
  });
  it.each([
    { accountId: "account-a", platform: "whatsapp", participantId: "60199999999", status: 403 },
    { accountId: "account-b", platform: "whatsapp", participantId: "60123456789", status: 404 },
    { accountId: "account-a", platform: "instagram", participantId: "60123456789", status: 404 },
  ])("rejects the wrong sender, account or platform: %j", async mismatch => {
    const f = await fixture(); await f.webhook(f.event());
    f.db.sqlite.exec("UPDATE whatsapp_settings SET dry_run=0 WHERE firm_id='a'");
    const job = (await f.claim())!, ctx = await f.context(job);
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      expect(init?.method).toBe("GET");
      return Response.json({ data: { id: "conversation-a", ...mismatch } });
    });
    expect((await f.request(`${prefix}/jobs/${job.id}/reply`, "POST", { body: "No send", context_version: ctx.context_version }, job)).status).toBe(mismatch.status);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(f.db.sqlite.prepare("SELECT count(*) n FROM whatsapp_messages WHERE direction='outgoing'").get()!.n).toBe(0);
  });
  it("does not search for a replacement when the job conversation is unavailable", async () => {
    const f = await fixture(); await f.webhook(f.event());
    f.db.sqlite.exec("UPDATE whatsapp_settings SET dry_run=0 WHERE firm_id='a'");
    const job = (await f.claim())!, ctx = await f.context(job);
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 404 }));
    expect((await f.request(`${prefix}/jobs/${job.id}/reply`, "POST", { body: "No send", context_version: ctx.context_version }, job)).status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(1);
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
