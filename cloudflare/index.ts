import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { z, ZodError } from "zod";
import { auth } from "./auth";
import { schemas, type Resource } from "./validation";
import { digest, fail, now, rateLimit, scopeNames, token } from "./security";
import type { Env, Identity } from "./types";
import { whatsappRoutes } from "./whatsapp";
import { openapi } from "./openapi";
import { ZernioError } from "./zernio";
import { storeDocument } from "./documents";
import { replyAssistantRoutes } from "./reply-assistant";

type AppEnv = { Bindings: Env; Variables: { identity: Identity } };
export type AppContext = Context<AppEnv>;
const app = new Hono<AppEnv>();
app.use("/api/*", bodyLimit({ maxSize: 12 * 1024 * 1024, onError: c => c.json({ error: "Request too large." }, 413) }));
const uid = () => crypto.randomUUID();
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
const jsonBody = async (c: AppContext) => {
  try { return await c.req.json(); } catch { return fail(400, "Send valid JSON."); }
};
export const identity = (c: AppContext) => c.get("identity");
export function firm(c: AppContext) {
  return identity(c).firmId || fail(403, "Create or join a workspace first.");
}
export function owner(c: AppContext) {
  if (identity(c).role !== "owner" || identity(c).keyId) fail(403, "Workspace owner session required.");
  return firm(c);
}
export function scope(c: AppContext, permission: string) {
  if (identity(c).keyId && !identity(c).scopes.includes(permission)) fail(403, `API key requires ${permission}.`);
}
function sessionOnly(c: AppContext) {
  if (identity(c).keyId) fail(403, "Sign in to manage your account.");
}
export function audit(c: AppContext, title: string, detail: string, kind = "case", caseId: string | null = null) {
  const i = identity(c);
  return c.env.DB.prepare("INSERT INTO activities(id,firm_id,case_id,title,detail,kind,actor,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .bind(uid(), firm(c), caseId, title, detail, kind, i.keyId ? `API ${i.email} (${i.keyId.slice(0,8)})` : i.email, now());
}
export async function belongs(c: AppContext, table: "cases" | "agents", id: string) {
  if (!await c.env.DB.prepare(`SELECT id FROM ${table} WHERE id=? AND firm_id=?`).bind(id, firm(c)).first()) fail(404, "Record not found.");
}

app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  if (!c.env.AUTH_SECRET || c.env.AUTH_SECRET.length < 32) fail(503, "Account service is not configured.");
  if (Number(c.req.header("content-length") || 0) > 12 * 1024 * 1024) fail(413, "Request too large.");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !c.req.path.startsWith("/api/webhooks/")) {
    const origin = c.req.header("origin");
    const expected = c.env.APP_ORIGIN || new URL(c.req.url).origin;
    if (origin && origin !== expected) fail(403, "Origin not allowed.");
    // Cookie-authenticated writes must come from our app. Non-browser API clients use Bearer keys.
    if (!origin && c.req.header("cookie") && !c.req.header("authorization")) fail(403, "Origin header required.");
  }
  await next();
});
app.get("/api/health", async c => {
  await c.env.DB.prepare("SELECT id FROM firms LIMIT 1").all();
  return c.json({ status: "ok", database: "cloudflare-d1", files: !!c.env.FILES });
});
app.post("/api/account/recover", async c => {
  await rateLimit(c.env, `recover:${c.req.header("cf-connecting-ip") || "local"}`, 5, 300);
  const b = z.object({ email: z.email().transform(v => v.toLowerCase()), recoveryCode: z.string().min(40).max(100), password: z.string().min(12).max(128) }).parse(await jsonBody(c));
  const hash = await digest(b.recoveryCode);
  const user = await c.env.DB.prepare('SELECT u.id FROM "user" u JOIN recovery_codes r ON r.user_id=u.id WHERE u.email=? AND r.token_hash=?').bind(b.email, hash).first<{ id: string }>();
  if (!user) fail(400, "Email or recovery code is incorrect.");
  const password = await hashPassword(b.password);
  const condition = "EXISTS(SELECT 1 FROM recovery_codes WHERE user_id=? AND token_hash=?)";
  const results = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(`UPDATE account SET password=?,updatedAt=? WHERE userId=? AND providerId='credential' AND ${condition}`).bind(password, Date.now(), user.id, user.id, hash),
    c.env.DB.prepare(`DELETE FROM session WHERE userId=? AND ${condition}`).bind(user.id, user.id, hash),
    c.env.DB.prepare(`UPDATE api_keys SET revoked_at=? WHERE user_id=? AND ${condition}`).bind(now(), user.id, user.id, hash),
    c.env.DB.prepare("DELETE FROM recovery_codes WHERE user_id=? AND token_hash=?").bind(user.id, hash),
  ]);
  if (!results[0].meta.changes) fail(400, "Recovery code has already been used.");
  return c.json({ success: true });
});
app.on(["GET", "POST"], "/api/auth/*", c => auth(c.env, new URL(c.req.url).origin).handler(c.req.raw));
app.get("/api/openapi.json", c => c.json(openapi(new URL(c.req.url).origin)));

app.use("/api/v1/*", async (c, next) => {
  let i: Identity;
  const bearer = c.req.header("authorization");
  if (bearer) {
    if (!/^Bearer ct_[a-f0-9]{64}$/.test(bearer)) fail(401, "Invalid API key.");
    const row = await c.env.DB.prepare(`SELECT k.id,k.user_id,k.firm_id,k.scopes,m.email,m.role FROM api_keys k
      JOIN workspace_members m ON m.user_id=k.user_id AND m.firm_id=k.firm_id
      WHERE k.token_hash=? AND k.revoked_at IS NULL AND k.expires_at>?`)
      .bind(await digest(bearer.slice(7)), now()).first<{ id: string; user_id: string; firm_id: string; scopes: string; email: string; role: string }>();
    if (!row) fail(401, "API key is expired, revoked, or unavailable.");
    i = { userId: row.user_id, email: row.email, firmId: row.firm_id, role: row.role, keyId: row.id, scopes: JSON.parse(row.scopes) };
    await rateLimit(c.env, `api:${row.id}`);
    c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE api_keys SET last_used_at=? WHERE id=?").bind(now(), row.id).run());
  } else {
    const s = await auth(c.env, new URL(c.req.url).origin).api.getSession({ headers: c.req.raw.headers });
    if (!s) fail(401, "Please sign in.");
    const m = await c.env.DB.prepare("SELECT firm_id,role FROM workspace_members WHERE user_id=?").bind(s.user.id).first<{ firm_id: string; role: string }>();
    i = { userId: s.user.id, email: s.user.email, firmId: m?.firm_id || null, role: m?.role || null, scopes: [...scopeNames] };
    await rateLimit(c.env, `user:${s.user.id}`, 300);
  }
  c.set("identity", i);
  await next();
});
app.get("/api/v1/me", c => c.json(identity(c)));
app.get("/api/v1/workspace", async c => {
  scope(c, "workspace:read");
  const f = identity(c).firmId;
  if (!f) return c.json(null);
  const details = await c.env.DB.prepare("SELECT id,name,email FROM firms WHERE id=?").bind(f).first();
  return c.json({ firm: details });
});
app.post("/api/v1/workspace", async c => {
  sessionOnly(c);
  if (identity(c).firmId) fail(409, "You already belong to a workspace.");
  const { name } = z.object({ name: z.string().trim().min(1).max(150) }).parse(await jsonBody(c));
  const id = uid(), i = identity(c);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO firms(id,name,email,owner_id,created_at) VALUES(?,?,?,?,?)").bind(id, name, i.email, i.userId, now()),
    c.env.DB.prepare("INSERT INTO workspace_members(user_id,firm_id,email,role,created_at) VALUES(?,?,?,'owner',?)").bind(i.userId, id, i.email, now()),
  ]);
  return c.json({ id }, 201);
});
app.patch("/api/v1/workspace", async c => {
  const f = owner(c);
  const b = z.object({ name: z.string().trim().min(1).max(150), email: z.union([z.email(), z.literal("")]) }).parse(await jsonBody(c));
  await c.env.DB.batch([c.env.DB.prepare("UPDATE firms SET name=?,email=? WHERE id=?").bind(b.name, b.email, f), audit(c, "Firm settings updated", b.name)]);
  return c.json({ success: true });
});
app.get("/api/v1/team", async c => {
  scope(c, "workspace:read");
  const members = await c.env.DB.prepare("SELECT user_id,email,role FROM workspace_members WHERE firm_id=?").bind(firm(c)).all();
  const invites = identity(c).role === "owner" && !identity(c).keyId ? (await c.env.DB.prepare("SELECT id,email,expires_at FROM workspace_invites WHERE firm_id=?").bind(firm(c)).all()).results : [];
  return c.json({ members: members.results, invites, owner: identity(c).role === "owner" });
});
app.post("/api/v1/invitations", async c => {
  const f = owner(c);
  const { email } = z.object({ email: z.email().transform(v => v.toLowerCase()) }).parse(await jsonBody(c));
  const secret = token(), id = uid();
  await c.env.DB.prepare(`INSERT INTO workspace_invites(id,firm_id,email,token_hash,expires_at) VALUES(?,?,?,?,?)
    ON CONFLICT(firm_id,email) DO UPDATE SET id=excluded.id,token_hash=excluded.token_hash,expires_at=excluded.expires_at`)
    .bind(id, f, email, await digest(secret), future(7)).run();
  return c.json({ id, url: `${c.env.APP_ORIGIN || new URL(c.req.url).origin}/join#${secret}` }, 201);
});
app.post("/api/v1/invitations/accept", async c => {
  sessionOnly(c);
  if (identity(c).firmId) fail(409, "You already belong to a workspace.");
  const b = z.object({ token: z.string().length(64) }).parse(await jsonBody(c));
  const hash = await digest(b.token), i = identity(c);
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO workspace_members(user_id,firm_id,email,role,created_at)
      SELECT ?,firm_id,?,'member',? FROM workspace_invites WHERE token_hash=? AND email=? AND expires_at>?`)
      .bind(i.userId, i.email, now(), hash, i.email.toLowerCase(), now()),
    c.env.DB.prepare("DELETE FROM workspace_invites WHERE token_hash=? AND email=? AND EXISTS(SELECT 1 FROM workspace_members WHERE user_id=?)").bind(hash, i.email.toLowerCase(), i.userId),
  ]);
  if (!result[0].meta.changes) fail(400, "Invitation is expired, invalid, or belongs to another email address.");
  return c.json({ success: true });
});
app.delete("/api/v1/invitations/:id", async c => {
  await c.env.DB.prepare("DELETE FROM workspace_invites WHERE id=? AND firm_id=?").bind(c.req.param("id"), owner(c)).run();
  return c.json({ success: true });
});
app.delete("/api/v1/team/:id", async c => {
  const f = owner(c), id = c.req.param("id");
  if (id === identity(c).userId) fail(400, "You cannot remove yourself.");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE api_keys SET revoked_at=? WHERE user_id=? AND firm_id=?").bind(now(), id, f),
    c.env.DB.prepare("DELETE FROM workspace_members WHERE user_id=? AND firm_id=? AND role='member'").bind(id, f),
    audit(c, "Workspace member removed", id),
  ]);
  return c.json({ success: true });
});
app.get("/api/v1/keys", async c => {
  sessionOnly(c);
  const i = identity(c);
  const rows = await c.env.DB.prepare(`SELECT id,name,prefix,scopes,created_at,expires_at,last_used_at,revoked_at,user_id FROM api_keys WHERE firm_id=? ${i.role === "owner" ? "" : "AND user_id=?"} ORDER BY created_at DESC`)
    .bind(...(i.role === "owner" ? [firm(c)] : [firm(c), i.userId])).all();
  return c.json(rows.results.map(r => ({ ...r, scopes: JSON.parse(String(r.scopes)) })));
});
app.post("/api/v1/keys", async c => {
  sessionOnly(c);
  const b = z.object({ name: z.string().trim().min(1).max(100), scopes: z.array(z.enum(scopeNames)).min(1).max(scopeNames.length), days: z.number().int().min(1).max(365).default(90) }).parse(await jsonBody(c));
  if (b.scopes.includes("assistant:reply")) {
    owner(c);
    if (b.scopes.length !== 1) fail(400, "Reply assistant keys must have only assistant:reply permission.");
  }
  const count = await c.env.DB.prepare("SELECT count(*) AS n FROM api_keys WHERE firm_id=? AND revoked_at IS NULL AND expires_at>?").bind(firm(c), now()).first<{ n: number }>();
  if ((count?.n || 0) >= 50) fail(400, "Revoke an unused key before creating another (50 active keys maximum).");
  const secret = token("ct_"), id = uid();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO api_keys(id,firm_id,user_id,name,prefix,token_hash,scopes,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(id, firm(c), identity(c).userId, b.name, secret.slice(0, 11), await digest(secret), JSON.stringify(b.scopes), now(), future(b.days)),
    audit(c, "API key created", `${b.name}: ${b.scopes.join(", ")}`),
  ]);
  return c.json({ id, key: secret }, 201);
});
app.delete("/api/v1/keys/:id", async c => {
  sessionOnly(c);
  const i = identity(c);
  await c.env.DB.prepare("UPDATE api_keys SET revoked_at=? WHERE id=? AND firm_id=? AND (user_id=? OR ?='owner')")
    .bind(now(), c.req.param("id"), firm(c), i.userId, i.role).run();
  return c.json({ success: true });
});
app.post("/api/v1/account/recovery-code", async c => {
  sessionOnly(c);
  const { password } = z.object({ password: z.string().max(128) }).parse(await jsonBody(c));
  const a = await c.env.DB.prepare("SELECT password FROM account WHERE userId=? AND providerId='credential'").bind(identity(c).userId).first<{ password: string }>();
  if (!a || !await verifyPassword({ hash: a.password, password })) fail(400, "Current password is incorrect.");
  const code = token("recovery_");
  await c.env.DB.prepare("INSERT INTO recovery_codes(user_id,token_hash,created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at").bind(identity(c).userId, await digest(code), now()).run();
  return c.json({ code });
});

for (const resource of Object.keys(schemas) as Resource[]) {
  app.get(`/api/v1/${resource}`, async c => {
    scope(c, `${resource}:read`);
    const limit = Math.min(200, Math.max(1, Math.floor(Number(c.req.query("limit")) || 100)));
    const cursor = c.req.query("cursor") || "";
    const rows = await c.env.DB.prepare(`SELECT * FROM ${resource} WHERE firm_id=? AND id>? ORDER BY id LIMIT ?`).bind(firm(c), cursor, limit + 1).all();
    const data = rows.results.slice(0, limit).map(r => resource === "tasks" ? { ...r, completed: !!r.completed } : r);
    return c.json({ data, nextCursor: rows.results.length > limit ? data.at(-1)?.id : null });
  });
  app.get(`/api/v1/${resource}/:id`, async c => {
    scope(c, `${resource}:read`);
    const row = await c.env.DB.prepare(`SELECT * FROM ${resource} WHERE id=? AND firm_id=?`).bind(c.req.param("id"), firm(c)).first();
    if (!row) fail(404, "Record not found.");
    return c.json(resource === "tasks" ? { ...row, completed: !!row.completed } : row);
  });
  const save = async (c: AppContext, update: boolean) => {
    scope(c, `${resource}:write`);
    const f = firm(c), input = await jsonBody(c);
    const id = update ? c.req.param("id") : (input.id ? z.uuid().parse(input.id) : uid());
    const existing = await c.env.DB.prepare(`SELECT * FROM ${resource} WHERE id=? AND firm_id=?`).bind(id, f).first();
    if (update && !existing) fail(404, "Record not found.");
    if (!update && existing) fail(409, "Record already exists.");
    const parsed = schemas[resource].parse(update ? { ...existing, ...(resource === "tasks" ? { completed: !!existing?.completed } : {}), ...input } : input);
    if ("agent_id" in parsed && parsed.agent_id) await belongs(c, "agents", parsed.agent_id);
    if ("case_id" in parsed && parsed.case_id) await belongs(c, "cases", parsed.case_id);
    const data: Record<string, unknown> = { ...parsed };
    if (resource === "cases") data.updated_at = now();
    const columns = Object.keys(data);
    const values = columns.map(k => typeof data[k] === "boolean" ? Number(data[k]) : data[k] ?? null);
    const statement = update
      ? c.env.DB.prepare(`UPDATE ${resource} SET ${columns.map(k => `${k}=?`).join(",")} WHERE id=? AND firm_id=?`).bind(...values, id, f)
      : c.env.DB.prepare(`INSERT INTO ${resource}(id,firm_id,created_at,${columns.join(",")}) VALUES(${Array(columns.length + 3).fill("?").join(",")})`).bind(id, f, now(), ...values);
    await c.env.DB.batch([statement, audit(c, `${resource === "cases" ? "Case" : resource === "agents" ? "Agent" : "Follow-up"} ${update ? "updated" : "created"}`, String(data.ref || data.name || data.title), resource === "cases" ? "case" : resource === "agents" ? "agent" : "task", resource === "cases" ? id : "case_id" in parsed ? parsed.case_id : null)]);
    return c.json(await c.env.DB.prepare(`SELECT * FROM ${resource} WHERE id=? AND firm_id=?`).bind(id, f).first(), update ? 200 : 201);
  };
  app.post(`/api/v1/${resource}`, c => save(c, false));
  app.patch(`/api/v1/${resource}/:id`, c => save(c, true));
}
app.get("/api/v1/activities", async c => {
  scope(c, "activities:read");
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 100));
  const rows = await c.env.DB.prepare("SELECT * FROM activities WHERE firm_id=? AND id>? ORDER BY id LIMIT ?").bind(firm(c), c.req.query("cursor") || "", limit + 1).all();
  const data = rows.results.slice(0, limit);
  return c.json({ data, nextCursor: rows.results.length > limit ? data.at(-1)?.id : null });
});
app.post("/api/v1/cases/:id/notes", async c => {
  scope(c, "notes:write"); await belongs(c, "cases", c.req.param("id"));
  const { note } = z.object({ note: z.string().trim().min(1).max(10000) }).parse(await jsonBody(c));
  await audit(c, "Internal note added", note, "note", c.req.param("id")).run();
  return c.json({ success: true }, 201);
});
app.get("/api/v1/documents", async c => {
  scope(c, "documents:read");
  const rows = await c.env.DB.prepare("SELECT id,case_id,filename,content_type,size,created_at,actor FROM documents WHERE firm_id=? AND id>? ORDER BY id LIMIT 101")
    .bind(firm(c), c.req.query("cursor") || "").all();
  const data = rows.results.slice(0, 100);
  return c.json({ data, nextCursor: rows.results.length > 100 ? data.at(-1)?.id : null });
});
app.post("/api/v1/cases/:id/documents", async c => {
  scope(c, "documents:write"); const f = firm(c), caseId = c.req.param("id");
  await belongs(c, "cases", caseId);
  if (!c.env.FILES) fail(503, "Document storage is not configured.");
  const form = await c.req.formData(), file = form.get("file");
  if (!file || typeof file === "string") fail(400, "Choose a file.");
  if (file.size > 10 * 1024 * 1024 || !file.size) fail(413, "Files must be between 1 byte and 10 MB.");
  const id = uid(), key = `${f}/${caseId}/${id}`;
  const filename = file.name.replace(/[^\p{L}\p{N}._ ()-]/gu, "_").slice(0, 180) || "document";
  await storeDocument(c.env, { id, firmId: f, key }, file, () =>
    c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO documents(id,firm_id,case_id,filename,object_key,content_type,size,created_at,actor) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(id, f, caseId, filename, key, file.type || "application/octet-stream", file.size, now(), identity(c).email),
      audit(c, "Document uploaded", filename, "case", caseId),
    ]));
  return c.json({ id, filename, size: file.size }, 201);
});
app.get("/api/v1/documents/:id/download", async c => {
  scope(c, "documents:read");
  const doc = await c.env.DB.prepare("SELECT object_key,filename FROM documents WHERE id=? AND firm_id=?").bind(c.req.param("id"), firm(c)).first<{ object_key: string; filename: string }>();
  if (!doc || !c.env.FILES) fail(404, "Document not found.");
  const file = await c.env.FILES.get(doc.object_key);
  if (!file) fail(404, "Document not found.");
  return new Response(file.body, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
});

whatsappRoutes(app);
replyAssistantRoutes(app);
app.notFound(c => c.json({ error: "Endpoint not found." }, 404));
app.onError((error, c) => {
  if (error instanceof ZernioError) return c.json({error:error.status===404 ? "Conversation not found in this firm's WhatsApp account." : "WhatsApp provider is unavailable or rejected the connection. Check the saved account and credentials."},error.status===404?404:503);
  if (error instanceof SyntaxError) return c.json({ error: "Send valid JSON." }, 400);
  if (error instanceof ZodError) return c.json({ error: error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  const message = String(error);
  if (message.includes("UNIQUE constraint")) return c.json({ error: "This record already exists." }, 409);
  if (message.includes("FOREIGN KEY")) return c.json({ error: "A linked record is unavailable." }, 400);
  console.error("API failure", error instanceof Error ? error.name : "unknown",
    error instanceof TypeError ? error.stack?.split("\n").filter(line=>line.trim().startsWith("at ")).slice(0,3) : undefined); // Stack frames only; no record contents or credentials.
  return c.json({ error: "The request could not be completed. Please try again." }, 500);
});
export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
};
