// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../cloudflare/index";
import { runSchedules } from "../cloudflare/scheduler";
import { digest } from "../cloudflare/security";
import type { Env } from "../cloudflare/types";

// Execute the actual application SQL, including migrations and transaction rollback.
class LocalD1 {
  sqlite = new DatabaseSync(":memory:");
  failSql?: (sql: string, values: unknown[]) => boolean;
  failDocuments = false;
  ambiguousCommit = false;
  constructor() {
    for (const name of readdirSync("cloudflare/migrations").sort()) {
      this.sqlite.exec(readFileSync(`cloudflare/migrations/${name}`, "utf8"));
    }
  }
  prepare(sql: string) {
    const db = this;
    let values: any[] = [];
    const execute = () => {
      if (db.failSql?.(sql, values) || (db.failDocuments && sql.startsWith("INSERT INTO documents"))) throw Error("Injected database failure");
      const results = db.sqlite.prepare(sql).all(...values);
      return { success: true, results, meta: { changes: Number(db.sqlite.prepare("SELECT changes() AS n").get()!.n) } };
    };
    const statement = {
      bind(...args: any[]) { values = args; return statement; },
      async first(column?: string) { const row = execute().results[0]; return column ? row?.[column] ?? null : row ?? null; },
      async all() { return execute(); },
      async run() { return execute(); },
      execute,
    };
    return statement;
  }
  async batch(statements: ReturnType<LocalD1["prepare"]>[]) {
    this.sqlite.exec("BEGIN");
    let results;
    try {
      results = statements.map(s => s.execute());
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
    if (this.ambiguousCommit) throw Error("Response lost after commit");
    return results;
  }
}

const opened: LocalD1[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.sqlite.close(); vi.restoreAllMocks(); });
const caseA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const caseB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const oldDate = "1970-01-01T00:00:00.000Z";
const laterDate = "2000-01-01T00:00:00.000Z";
const keyA = `ct_${"1".repeat(64)}`, keyB = `ct_${"2".repeat(64)}`;

async function fixture() {
  const db = new LocalD1(); opened.push(db);
  for (const [firm, id, key] of [["a", caseA, keyA], ["b", caseB, keyB]]) {
    db.sqlite.prepare('INSERT INTO "user"(id,name,email,createdAt,updatedAt) VALUES(?,?,?,0,0)').run(firm, firm, `${firm}@example.test`);
    db.sqlite.prepare("INSERT INTO firms VALUES(?,?,?,?,'2026-01-01')").run(firm, firm, `${firm}@example.test`, firm);
    db.sqlite.prepare("INSERT INTO workspace_members VALUES(?,?,?,'owner','2026-01-01')").run(firm, firm, `${firm}@example.test`);
    db.sqlite.prepare("INSERT INTO api_keys(id,firm_id,user_id,name,prefix,token_hash,scopes,created_at,expires_at) VALUES(?,?,?,?,?,?,?,'2026-01-01','2099-01-01')")
      .run(firm, firm, firm, "Test key", "ct_test", await digest(key), JSON.stringify(["documents:write", "documents:read", "whatsapp:write"]));
    db.sqlite.prepare("INSERT INTO agents(id,firm_id,name,created_at) VALUES(?,?,?,'2026-01-01')").run(firm, firm, firm);
    db.sqlite.prepare("INSERT INTO cases(id,firm_id,ref,buyer,type,status,priority,agent_id,created_at,updated_at) VALUES(?,?,?,?,'SPA','spa','normal',?,'2026-01-01','2026-01-01')")
      .run(id, firm, firm, "Synthetic", firm);
    db.sqlite.prepare("INSERT INTO whatsapp_contacts(firm_id,agent_id,phone,enabled,consent) VALUES(?,?,?,1,1)").run(firm, firm, "+60123456789");
    db.sqlite.prepare("INSERT INTO whatsapp_settings(firm_id,access_token,enabled,dry_run,updated_at) VALUES(?,'synthetic-preview',1,1,'2026-01-01')").run(firm);
  }
  const objects = new Map<string, ArrayBuffer>();
  const bucket = {
    put: vi.fn(async (key: string, bytes: ArrayBuffer) => { objects.set(key, bytes); return {}; }),
    delete: vi.fn(async (key: string) => { objects.delete(key); }),
    get: vi.fn(async (key: string) => objects.has(key) ? { body: objects.get(key) } : null),
  };
  const env = { DB: db, FILES: bucket, AUTH_SECRET: "synthetic-auth-secret-for-unit-tests-only" } as unknown as Env;
  const ctx = { waitUntil: (_promise: Promise<unknown>) => {} } as ExecutionContext;
  async function request(path: string, key = keyA, init: RequestInit = {}) {
    return worker.fetch(new Request(`https://example.test/api/v1${path}`, {
      ...init, headers: { Authorization: `Bearer ${key}`, ...init.headers },
    }), env, ctx);
  }
  async function upload(bytes: string, key = keyA, id = caseA) {
    const form = new FormData(); form.set("file", new File([bytes], "case.txt", { type: "text/plain" }));
    return request(`/cases/${id}/documents`, key, { method: "POST", body: form });
  }
  return { db, env, bucket, objects, request, upload };
}
function schedule(db: LocalD1, firm: string, caseId: string, date: string) {
  db.sqlite.prepare("INSERT INTO whatsapp_rules(firm_id,case_id,enabled,interval_hours,next_due_at,template_name) VALUES(?,?,1,24,?,'case_update') ON CONFLICT(firm_id,case_id) DO UPDATE SET next_due_at=excluded.next_due_at")
    .run(firm, caseId, date);
}
function preseed(db: LocalD1, key: string) {
  db.sqlite.prepare("INSERT INTO whatsapp_messages(id,firm_id,case_id,phone,direction,body,status,idempotency_key,created_at,actor) VALUES('legacy','a',?,'+60123456789','outgoing','Preview','preview',?,'2026-01-01','API')")
    .run(caseA, key);
}

describe("Shared scheduler isolation", () => {
  it("contains a caller-preseeded collision and still processes another firm and cleanup", async () => {
    const { db, env } = await fixture();
    preseed(db, `schedule:${caseA}:${oldDate}`);
    schedule(db, "a", caseA, oldDate); schedule(db, "b", caseB, laterDate);
    db.sqlite.exec("INSERT INTO api_usage VALUES('expired-marker',1,0)");
    await expect(runSchedules(env)).resolves.toBeUndefined();
    expect(db.sqlite.prepare("SELECT status FROM whatsapp_messages WHERE id='legacy'").get()!.status).toBe("preview");
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM whatsapp_messages WHERE firm_id='b'").get()!.n).toBe(1);
    expect(db.sqlite.prepare("SELECT * FROM api_usage WHERE key='expired-marker'").get()).toBeUndefined();
  });
  it("deduplicates an already processed timestamp without stopping later work", async () => {
    const { db, env } = await fixture();
    schedule(db, "a", caseA, oldDate); await runSchedules(env);
    schedule(db, "a", caseA, oldDate); schedule(db, "b", caseB, laterDate);
    await expect(runSchedules(env)).resolves.toBeUndefined();
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM whatsapp_messages").get()!.n).toBe(2);
  });
  it("isolates failures before insertion and runs cleanup even if due selection fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, env } = await fixture();
    schedule(db, "a", caseA, oldDate); schedule(db, "b", caseB, laterDate);
    db.failSql = (sql, values) => sql.startsWith("UPDATE whatsapp_rules") && values[1] === "a";
    await expect(runSchedules(env)).resolves.toBeUndefined();
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM whatsapp_messages WHERE firm_id='b'").get()!.n).toBe(1);
    db.sqlite.exec("INSERT INTO api_usage VALUES('expired-marker',1,0)");
    db.failSql = sql => sql.startsWith("SELECT r.*");
    await expect(runSchedules(env)).rejects.toThrow("Injected database failure");
    expect(db.sqlite.prepare("SELECT * FROM api_usage WHERE key='expired-marker'").get()).toBeUndefined();
  });
  it("reserves new schedule keys while preserving ordinary and legacy retries", async () => {
    const { db, request } = await fixture();
    const body = JSON.stringify({ phone: "+60123456789", body: "Preview", case_id: caseA });
    const send = (key: string, payload = body) => request("/whatsapp/messages", keyA, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: payload,
    });
    expect((await send(`schedule:${caseA}:${oldDate}`)).status).toBe(400);
    preseed(db, `schedule:${caseA}:${oldDate}`);
    expect((await send(`schedule:${caseA}:${oldDate}`)).status).toBe(200);
    expect((await send("normal-key")).status).toBe(201);
    expect((await send("normal-key")).status).toBe(200);
    expect((await send("normal-key", JSON.stringify({ phone: "+60123456789", body: "Changed", case_id: caseA }))).status).toBe(409);
  });
});

describe("Persistent document allocation", () => {
  it("caps cumulative firm bytes across requests while preserving download and tenant isolation", async () => {
    const { env, upload, request, bucket } = await fixture();
    Object.assign(env, { DOCUMENT_MAX_FIRM_BYTES: "8" });
    const first = await upload("12345");
    expect(first.status).toBe(201);
    const document = await first.json() as { id: string };
    expect(await (await request(`/documents/${document.id}/download`)).text()).toBe("12345");
    expect((await request(`/documents/${document.id}/download`, keyB)).status).toBe(404);
    expect((await upload("678")).status).toBe(201);
    expect((await upload("9")).status).toBe(413);
    expect(bucket.put).toHaveBeenCalledTimes(2);
  });
  it("enforces a global allowance across firms and counts pending concurrent uploads", async () => {
    const { env, upload, bucket } = await fixture();
    Object.assign(env, { DOCUMENT_MAX_TOTAL_BYTES: "8" });
    let unblock!: () => void, entered!: () => void;
    const reached = new Promise<void>(r => { entered = r; });
    bucket.put.mockImplementationOnce(async () => { entered(); await new Promise<void>(r => { unblock = r; }); return {}; });
    const first = upload("12345"); await reached;
    try { expect((await upload("6789", keyB, caseB)).status).toBe(413); }
    finally { unblock(); await first; }
    expect(bucket.put).toHaveBeenCalledTimes(1);
  });
  it("caps file counts for tiny uploads and shares firm allowances between keys", async () => {
    const { db, env, upload } = await fixture();
    Object.assign(env, { DOCUMENT_MAX_FIRM_FILES: "1", DOCUMENT_MAX_TOTAL_FILES: "2" });
    const anotherKey = `ct_${"3".repeat(64)}`;
    db.sqlite.prepare("INSERT INTO api_keys(id,firm_id,user_id,name,prefix,token_hash,scopes,created_at,expires_at) VALUES('a2','a','a','Other','ct_test',?,'[\"documents:write\"]','2026-01-01','2099-01-01')")
      .run(await digest(anotherKey));
    expect((await upload("a")).status).toBe(201);
    expect((await upload("b", anotherKey)).status).toBe(413);
    expect((await upload("c", keyB, caseB)).status).toBe(201);
    Object.assign(env, { DOCUMENT_MAX_FIRM_FILES: "3" });
    expect((await upload("d")).status).toBe(413);
  });
  it.each(["0", "-1", "Infinity", "1.5", "9007199254740992", ""])("fails closed for malformed limit %j", async limit => {
    const { env, upload, bucket } = await fixture();
    Object.assign(env, { DOCUMENT_MAX_FIRM_BYTES: limit });
    expect((await upload("data")).status).toBe(503);
    expect(bucket.put).not.toHaveBeenCalled();
  });
  it("refunds failed writes only after confirmed cleanup", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, env, upload, bucket, objects } = await fixture();
    Object.assign(env, { DOCUMENT_MAX_FIRM_BYTES: "4" });
    db.failDocuments = true;
    expect((await upload("data")).status).toBe(500);
    expect(objects.size).toBe(0);
    db.failDocuments = false;
    expect((await upload("data")).status).toBe(201);
    expect(bucket.put).toHaveBeenCalledTimes(2);
  });
  it("retains allocation after an ambiguous put and failed cleanup", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { env, upload, bucket, objects } = await fixture();
    Object.assign(env, { DOCUMENT_MAX_FIRM_BYTES: "4" });
    bucket.put.mockImplementationOnce(async (key, bytes) => { objects.set(key, bytes); throw Error("Put response lost"); });
    bucket.delete.mockRejectedValueOnce(Error("Delete failed"));
    expect((await upload("data")).status).toBe(500);
    expect((await upload("data")).status).toBe(413);
    expect(objects.size).toBe(1);
    expect(bucket.put).toHaveBeenCalledTimes(1);
  });
  it("keeps a committed document when the metadata response is lost", async () => {
    const { db, env, upload, bucket } = await fixture();
    Object.assign(env, { DOCUMENT_MAX_FIRM_BYTES: "4" });
    db.ambiguousCommit = true;
    expect((await upload("data")).status).toBe(201);
    expect(bucket.delete).not.toHaveBeenCalled();
    expect((await upload("data")).status).toBe(413);
  });
  it("backfills existing documents and preserves downloads above a new limit", async () => {
    const { db, env, upload, objects, request } = await fixture();
    db.sqlite.exec("DROP TRIGGER documents_allocate_after_insert");
    db.sqlite.exec("DROP TABLE document_allocations");
    db.sqlite.prepare("INSERT INTO documents(id,firm_id,case_id,filename,object_key,content_type,size,created_at,actor) VALUES('existing','a',?,'old.txt','old-object','text/plain',5,'2026-01-01','Test')")
      .run(caseA);
    db.sqlite.exec(readFileSync("cloudflare/migrations/0006_document_allocations.sql", "utf8"));
    objects.set("old-object", new TextEncoder().encode("12345").buffer);
    Object.assign(env, { DOCUMENT_MAX_FIRM_BYTES: "4" });
    expect((await upload("x")).status).toBe(413);
    expect(await (await request("/documents/existing/download")).text()).toBe("12345");
    expect(db.sqlite.prepare("SELECT SUM(size) AS n FROM document_allocations").get()!.n).toBe(5);
  });
  it("counts uploads committed by the previous API during a rolling deployment", async () => {
    const { db, env, upload, bucket } = await fixture();
    db.sqlite.prepare("INSERT INTO documents(id,firm_id,case_id,filename,object_key,content_type,size,created_at,actor) VALUES('rolling','a',?,'old.txt','rolling-object','text/plain',5,'2026-01-01','Test')")
      .run(caseA);
    Object.assign(env, { DOCUMENT_MAX_FIRM_BYTES: "5" });
    expect(db.sqlite.prepare("SELECT size FROM document_allocations WHERE id='rolling'").get()!.size).toBe(5);
    expect((await upload("x")).status).toBe(413);
    expect(bucket.put).not.toHaveBeenCalled();
  });
  it("retains allocation if the cleanup metadata read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, env, upload, bucket, objects } = await fixture();
    Object.assign(env, { DOCUMENT_MAX_FIRM_BYTES: "4" });
    db.failDocuments = true;
    db.failSql = sql => sql.startsWith("SELECT id FROM documents");
    expect((await upload("data")).status).toBe(500);
    expect(bucket.delete).not.toHaveBeenCalled();
    expect(objects.size).toBe(1);
    db.failDocuments = false; db.failSql = undefined;
    expect((await upload("data")).status).toBe(413);
  });
});
