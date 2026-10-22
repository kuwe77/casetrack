// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { digest } from "../cloudflare/security";
import type { Env } from "../cloudflare/types";
vi.mock("../cloudflare/auth", () => ({ auth: () => ({ api: { getSession: async ({ headers }: { headers: Headers }) => {
  const id = headers.get("Test-User"); return id ? { user: { id, email: `${id}@example.test` } } : null;
} } }) }));
import worker from "../cloudflare/index";

const opened: DatabaseSync[] = [];
afterEach(() => { opened.splice(0).forEach(db => db.close()); });
class LocalD1 {
  sqlite = new DatabaseSync(":memory:");
  constructor(migrate = true) {
    opened.push(this.sqlite);
    this.sqlite.exec("PRAGMA foreign_keys=ON");
    for (const name of readdirSync("cloudflare/migrations").sort().filter(n => migrate || !n.startsWith("0009"))) {
      this.sqlite.exec(`BEGIN; ${readFileSync(`cloudflare/migrations/${name}`, "utf8")} COMMIT;`);
    }
  }
  prepare(sql: string) {
    const db = this.sqlite; let values: any[] = [];
    const execute = () => ({ success: true, results: db.prepare(sql).all(...values), meta: { changes: Number(db.prepare("SELECT changes() AS n").get()!.n) } });
    const statement = { bind(...args: any[]) { values = args; return statement; }, execute,
      async all() { return execute(); }, async run() { return execute(); }, async first(column?: string) { const row = execute().results[0]; return column ? row?.[column] ?? null : row ?? null; } };
    return statement;
  }
  async batch(statements: ReturnType<LocalD1["prepare"]>[]) {
    this.sqlite.exec("BEGIN");
    try { const result = statements.map(s => s.execute()); this.sqlite.exec("COMMIT"); return result; }
    catch (e) { this.sqlite.exec("ROLLBACK"); throw e; }
  }
}
async function fixture() {
  const db = new LocalD1();
  for (const id of ["owner", "colleague", "outsider"]) db.sqlite.prepare('INSERT INTO "user"(id,name,email,createdAt,updatedAt) VALUES(?,?,?,0,0)').run(id, id, `${id}@example.test`);
  const env = { DB: db, AUTH_SECRET: "synthetic-secret-at-least-thirty-two-characters" } as unknown as Env;
  const ctx = { waitUntil: (_p: Promise<unknown>) => {} } as ExecutionContext;
  const request = (path: string, options: { user?: string; firm?: string; key?: string; method?: string; body?: unknown } = {}) => worker.fetch(new Request(`https://example.test/api/v1${path}`, {
    method: options.method || "GET", headers: { Origin: "https://example.test", "Content-Type": "application/json", "Test-User": options.user || "owner", ...(options.firm ? { "X-Workspace-Id": options.firm } : {}), ...(options.key ? { Authorization: `Bearer ${options.key}` } : {}) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  }), env, ctx);
  const create = async (name: string, user = "owner") => {
    const response = await request("/workspace", { method: "POST", body: { name }, user }); expect(response.status).toBe(201);
    return (await response.json() as { id: string }).id;
  };
  const a = await create("Kuala Lumpur"), b = await create("Penang"), other = await create("Other firm", "outsider");
  return { db, request, a, b, other };
}
describe("Multiple workspaces", () => {
  it("creates several workspaces under one login and lists only its memberships", async () => {
    const { request, a, b } = await fixture();
    const list = await (await request("/workspaces", { firm: "removed-membership" })).json() as { id: string; role: string }[];
    expect(list.map(w => w.id).sort()).toEqual([a, b].sort()); expect(list.every(w => w.role === "owner")).toBe(true);
    expect((await (await request("/workspaces", { user: "colleague" })).json())).toEqual([]);
    expect((await (await request("/workspace", { firm: b })).json() as any).firm.name).toBe("Penang");
  });
  it("separates records and settings and rejects inaccessible workspaces and cross-workspace IDs", async () => {
    const { request, a, b, other } = await fixture();
    const agent = await (await request("/agents", { firm: a, method: "POST", body: { name: "Zakwan" } })).json() as any;
    const record = await (await request("/cases", { firm: a, method: "POST", body: { ref: "CT/2026/001", buyer: "Aisyah", agent_id: agent.id } })).json() as any;
    for (const path of ["/cases", "/agents", "/tasks", "/activities", "/documents"]) expect((await (await request(path, { firm: b })).json() as any).data).toEqual([]);
    expect((await request(`/cases/${record.id}`, { firm: b })).status).toBe(404);
    expect((await request(`/cases/${record.id}`, { firm: b, method: "PATCH", body: { buyer: "Changed" } })).status).toBe(404);
    expect((await request("/cases", { firm: b, method: "POST", body: { ref: "CT/2026/002", buyer: "Kelvin", agent_id: agent.id } })).status).toBe(404);
    expect((await request("/cases", { firm: other })).status).toBe(403);
    expect((await request("/workspace", { firm: other, method: "PATCH", body: { name: "Changed", email: "" } })).status).toBe(403);
    expect((await (await request("/whatsapp/assistant/settings", { firm: b })).json() as any).enabled).toBeFalsy();
    expect(await (await request("/keys", { firm: b })).json()).toEqual([]);
  });
  it("keeps API keys pinned even when the same owner belongs to both workspaces", async () => {
    const { request, a, b } = await fixture();
    const created = await request("/keys", { firm: a, method: "POST", body: { name: "Integration", scopes: ["workspace:read", "cases:read"], days: 90 } });
    const { key } = await created.json() as { key: string };
    expect((await (await request("/workspace", { key })).json() as any).firm.id).toBe(a);
    expect((await request("/workspace", { firm: b, key })).status).toBe(403);
    expect((await request("/workspaces", { key })).status).toBe(403);
    expect((await request("/workspace", { key, method: "POST", body: { name: "Forbidden" } })).status).toBe(403);
    expect((await request("/documents/any/download?workspace_id=" + b, { key })).status).toBe(403);
    expect(await (await request("/keys", { firm: b })).json()).toEqual([]);
  });
  it("allows an existing owner to join another workspace without gaining owner rights or downgrading existing ownership", async () => {
    const { request, a, b, other } = await fixture();
    const invite = async (firm: string, user: string, email: string) => (await (await request("/invitations", { firm, user, method: "POST", body: { email } })).json() as any).url.split("#")[1];
    const token = await invite(other, "outsider", "owner@example.test");
    expect((await request("/invitations/accept", { user: "colleague", method: "POST", body: { token } })).status).toBe(400);
    const accepted = await request("/invitations/accept", { firm: "stale", method: "POST", body: { token } });
    expect(accepted.status).toBe(200); expect((await accepted.json() as any).id).toBe(other);
    expect((await request("/workspace", { firm: other, method: "PATCH", body: { name: "Forbidden", email: "" } })).status).toBe(403);
    expect((await request("/invitations/accept", { method: "POST", body: { token } })).status).toBe(400);
    const ownToken = await invite(a, "owner", "owner@example.test");
    expect((await request("/invitations/accept", { method: "POST", body: { token: ownToken } })).status).toBe(200);
    expect((await (await request("/me", { firm: a })).json() as any).role).toBe("owner");
    expect((await (await request("/me", { firm: b })).json() as any).role).toBe("owner");
  });
  it("removing membership revokes only that workspace's access and keys", async () => {
    const { request, a, b, other } = await fixture();
    const token = (await (await request("/invitations", { firm: other, user: "outsider", method: "POST", body: { email: "owner@example.test" } })).json() as any).url.split("#")[1];
    await request("/invitations/accept", { method: "POST", body: { token } });
    const makeKey = async (firm: string) => (await (await request("/keys", { firm, method: "POST", body: { name: "Integration", scopes: ["workspace:read"] } })).json() as any).key;
    const ownKey = await makeKey(a), sharedKey = await makeKey(other);
    expect((await request("/team/owner", { firm: other, user: "outsider", method: "DELETE" })).status).toBe(200);
    expect((await request("/workspace", { key: sharedKey })).status).toBe(401);
    expect((await request("/workspace", { key: ownKey })).status).toBe(200);
    expect((await request("/workspace", { firm: other })).status).toBe(403);
    expect((await (await request("/workspaces")).json() as any[]).map(w => w.id).sort()).toEqual([a, b].sort());
  });
  it("pins private document downloads to the selected membership", async () => {
    const { request, a, other } = await fixture();
    expect((await request(`/documents/missing/download?workspace_id=${a}`)).status).toBe(404);
    expect((await request(`/documents/missing/download?workspace_id=${other}`)).status).toBe(403);
    expect((await request(`/documents/missing/download?workspace_id=${other}`, { firm: a })).status).toBe(400);
  });
});
it("migrates populated single-workspace tables without losing references, secrets, keys or triggers", async () => {
  const { sqlite: db } = new LocalD1(false);
  db.exec(`INSERT INTO "user"(id,name,email,createdAt,updatedAt) VALUES('u','User','u@example.test',0,0);
    INSERT INTO firms VALUES('f','Existing firm','u@example.test','u','2026-01-01');
    INSERT INTO workspace_members VALUES('u','f','u@example.test','owner','2026-01-01');
    INSERT INTO agents(id,firm_id,name,created_at) VALUES('a','f','Zakwan','2026-01-01');
    INSERT INTO cases(id,firm_id,ref,buyer,type,status,priority,agent_id,created_at,updated_at) VALUES('c','f','CT/001','Aisyah','SPA','spa','normal','a','2026-01-01','2026-01-01');
    INSERT INTO whatsapp_settings(firm_id,access_token,updated_at) VALUES('f','encrypted-existing-token','2026-01-01');
    INSERT INTO documents VALUES('d','f','c','agreement.pdf','f/object','application/pdf',42,'2026-01-01','User');`);
  db.prepare("INSERT INTO api_keys(id,firm_id,user_id,name,prefix,token_hash,scopes,created_at,expires_at) VALUES('k','f','u','Muse','ct_test',?,'[\"assistant:reply\"]','2026-01-01','2099-01-01')").run(await digest("synthetic"));
  const tables = ["firms", "workspace_members", "agents", "cases", "whatsapp_settings", "documents", "api_keys"];
  const snapshot = () => Object.fromEntries(tables.map(t => [t, db.prepare(`SELECT * FROM ${t}`).all()]));
  const before = snapshot(), triggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
  db.exec(`BEGIN; ${readFileSync("cloudflare/migrations/0009_multiple_workspaces.sql", "utf8")} COMMIT;`);
  expect(snapshot()).toEqual(before); expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all()).toEqual(triggers);
  db.exec("INSERT INTO firms VALUES('g','Second firm','','u','2026-01-02'); INSERT INTO workspace_members VALUES('u','g','u@example.test','owner','2026-01-02');");
  expect(db.prepare("SELECT count(*) AS n FROM workspace_members WHERE user_id='u'").get()!.n).toBe(2);
  expect(() => db.exec("INSERT INTO workspace_members VALUES('u','g','u@example.test','member','2026-01-02')")).toThrow();
  expect(() => db.exec("UPDATE cases SET firm_id='g' WHERE id='c'")).toThrow();
});
