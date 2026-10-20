import assert from "node:assert/strict";
import { createHmac, randomUUID, randomBytes } from "node:crypto";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8788";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname)) throw Error("Integration tests require a local Cloudflare runtime.");
const suffix = randomUUID().slice(0, 8), password = randomBytes(24).toString("hex");
const testIp = `192.0.2.${randomBytes(1)[0] || 1}`;
let checks = 0;
async function request(path, { method = "GET", body, cookie, key, headers = {} } = {}) {
  const r = await fetch(base + path, { method, headers: {
    Origin: base, "CF-Connecting-IP": testIp, ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    ...(cookie ? { Cookie: cookie } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers,
  }, body: body ? body instanceof FormData ? body : JSON.stringify(body) : undefined });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, cookie: r.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") };
}
function ok(actual, expected, description) {
  assert.equal(actual, expected, description); checks++; console.log(`PASS ${description}`);
}
async function signup(label) {
  const result = await request("/api/auth/sign-up/email", { method: "POST", body: { name: `Test ${label}`, email: `${label}-${suffix}@example.test`, password } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.ok(result.cookie);
  return { cookie: result.cookie, email: `${label}-${suffix}@example.test`, id: result.data.user.id };
}
const a = await signup("firm-a"), b = await signup("firm-b"), member = await signup("member");
const call = (user, path, options) => request("/api/v1" + path, { cookie: user.cookie, ...options });
const wa = await call(a, "/workspace", { method: "POST", body: { name: `Test Firm A ${suffix}` } });
const wb = await call(b, "/workspace", { method: "POST", body: { name: `Test Firm B ${suffix}` } });
ok(wa.status, 201, "self-service firm A");
ok(wb.status, 201, "self-service firm B");
const contact = await call(a, "/agents", { method: "POST", body: { name: "Test Property Agent", phone: "+60123456789" } });
ok(contact.status, 201, "create agent");
const matter = await call(a, "/cases", { method: "POST", body: { ref: `CT-${suffix}`, buyer: "Synthetic buyer", agent_id: contact.data.id } });
ok(matter.status, 201, "create case");
ok((await call(b, `/cases/${matter.data.id}`)).status, 404, "cross-firm read denied");
ok((await call(b, `/cases/${matter.data.id}`, { method: "PATCH", body: { buyer: "Intrusion" } })).status, 404, "cross-firm write denied");
ok((await call(b, "/cases", { method: "POST", body: { ref: "FORGED", buyer: "Test", agent_id: contact.data.id } })).status, 404, "cross-firm relationship denied");
ok((await call(a, "/cases", { method: "POST", body: { ref: "date", buyer: "Test", due_date: "2026-02-31" } })).status, 400, "invalid date rejected");
ok((await call(a, `/cases/${matter.data.id}`, { method: "PATCH", body: { firm_id: wb.data.id, status: "spa" } })).data.firm_id, wa.data.id, "tenant ID cannot be changed");
ok((await call(a, `/cases/${matter.data.id}/notes`, { method: "POST", body: { note: "Private test note" } })).status, 201, "internal note");
const readonly = await call(a, "/keys", { method: "POST", body: { name: "Read only", scopes: ["cases:read"], days: 1 } });
const writer = await call(a, "/keys", { method: "POST", body: { name: "Case writer", scopes: ["cases:read", "cases:write", "documents:read", "documents:write"], days: 1 } });
ok(readonly.status, 201, "create scoped key");
const keyCall = (key, path, options) => request("/api/v1" + path, { key, ...options });
ok((await keyCall(readonly.data.key, "/cases")).data.data.length, 1, "agent reads own firm data");
ok((await keyCall(readonly.data.key, `/cases/${matter.data.id}`, { method: "PATCH", body: { status: "loan" } })).status, 403, "read-only key cannot write");
ok((await keyCall(writer.data.key, `/cases/${matter.data.id}`, { method: "PATCH", body: { status: "loan" } })).status, 200, "write scope updates case");
ok((await keyCall(writer.data.key, "/keys", { method: "POST", body: { name: "Escalation", scopes: ["whatsapp:write"] } })).status, 403, "API key cannot mint credentials");
ok((await keyCall(writer.data.key, "/team")).status, 403, "API key cannot manage membership");
const reader = await call(a,"/keys",{method:"POST",body:{name:"Full data reader",days:1,scopes:["workspace:read","cases:read","agents:read","tasks:read","activities:read","documents:read","whatsapp:read"]}});
ok((await keyCall(reader.data.key,"/workspace")).data.firm.id,wa.data.id,"external agent reads firm metadata");
ok((await keyCall(reader.data.key,"/team")).data.members.length,1,"external agent reads firm team");
ok((await keyCall(reader.data.key,"/team")).data.invites.length,0,"external agent never reads invitation tokens");
ok((await keyCall(reader.data.key,"/me")).data.firmId,wa.data.id,"external agent discovers its firm and scopes");
ok((await keyCall(reader.data.key,"/whatsapp/connection")).data.enabled,0,"agent reads sanitized connection status");
ok((await keyCall(reader.data.key,"/whatsapp/settings")).status,403,"agent cannot read provider settings");
ok((await keyCall(reader.data.key,"/whatsapp/contacts")).data.length,0,"agent reads approved recipient metadata");
ok((await keyCall(writer.data.key,"/whatsapp/conversations")).status,403,"inbox read requires WhatsApp scope");
ok((await keyCall(reader.data.key,"/whatsapp/conversations")).status,400,"unconnected firm cannot access another firm's inbox");
const doc = new FormData(); doc.set("file", new File(["Synthetic test document"], "case.txt", { type: "text/plain" }));
const upload = await keyCall(writer.data.key, `/cases/${matter.data.id}/documents`, { method: "POST", body: doc });
ok(upload.status, 201, "private R2 document upload");
ok((await keyCall(writer.data.key, `/documents/${upload.data.id}/download`)).data, "Synthetic test document", "authorized R2 download");
ok((await call(b, `/documents/${upload.data.id}/download`)).status, 404, "cross-firm document access denied");
ok((await call(a, "/keys")).data.some(k => "token_hash" in k || "key" in k), false, "API key secrets never returned");
const invite = await call(a, "/invitations", { method: "POST", body: { email: member.email } });
ok(invite.status, 201, "owner creates private invitation");
ok((await call(member, "/invitations/accept", { method: "POST", body: { token: "0".repeat(64) } })).status, 400, "guessed invitation rejected");
ok((await call(member, "/invitations/accept", { method: "POST", body: { token: invite.data.url.split("#")[1] } })).status, 200, "invited member joins");
ok((await call(member, "/invitations", { method: "POST", body: { email: "new@example.test" } })).status, 403, "member cannot invite others");
const mk = await call(member, "/keys", { method: "POST", body: { name: "Member key", scopes: ["cases:read"] } });
ok(mk.status, 201, "member gets individually owned API key");
await call(a, `/team/${member.id}`, { method: "DELETE" });
ok((await keyCall(mk.data.key, "/cases")).status, 401, "member removal revokes agent access");
await call(a, `/keys/${readonly.data.id}`, { method: "DELETE" });
ok((await keyCall(readonly.data.key, "/cases")).status, 401, "key revocation is immediate");
ok((await call(a, "/workspace", { method: "PATCH", body: { name: "CSRF", email: a.email }, headers: { Origin: "https://evil.example" } })).status, 403, "cross-origin cookie write denied");
ok((await request("/api/v1/cases")).status, 401, "anonymous access denied");
// Synthetic credentials with preview enabled: no test sends a message to Meta.
const appSecret = randomBytes(24).toString("hex");
const settings = await call(a, "/whatsapp/settings", { method:"PUT", body:{phone_number_id:"12345678901",access_token:"synthetic-test-token",app_secret:appSecret,enabled:true,dry_run:true} });
ok(settings.status,200,"WhatsApp credentials saved for preview");
const visibleSettings = await call(a,"/whatsapp/settings");
ok(JSON.stringify(visibleSettings.data).includes(appSecret),false,"Meta secret never returned");
ok((await call(b,"/whatsapp/settings")).data.settings.has_token,false,"provider settings isolated by firm");
const webhook = `/api/webhooks/whatsapp/${wa.data.id}`;
ok((await request(`${webhook}?hub.mode=subscribe&hub.verify_token=${settings.data.verifyToken}&hub.challenge=test-challenge`)).data,"test-challenge","Meta webhook verification");
ok((await request(`${webhook}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=bad`)).status,403,"wrong verification token rejected");
const phone = "+60123456789";
await call(a,`/whatsapp/contacts/${contact.data.id}`,{method:"PUT",body:{phone,enabled:true,consent:true}});
const message = { phone, body:"Synthetic update", case_id:matter.data.id }, idem = randomUUID();
const preview = await call(a,"/whatsapp/messages",{method:"POST",body:message,headers:{"Idempotency-Key":idem}});
ok(preview.data.status,"preview","preview mode does not send externally");
ok((await call(a,"/whatsapp/messages",{method:"POST",body:message,headers:{"Idempotency-Key":idem}})).data.id,preview.data.id,"retry does not duplicate message");
ok((await call(a,"/whatsapp/messages",{method:"POST",body:{...message,body:"Different"},headers:{"Idempotency-Key":idem}})).status,409,"idempotency payload conflict rejected");
ok((await keyCall(writer.data.key,"/whatsapp/messages",{method:"POST",body:message,headers:{"Idempotency-Key":randomUUID()}})).status,403,"case-write key cannot send WhatsApp");
async function incoming(text, id, signature = true, phoneId = "12345678901") {
  const payload = JSON.stringify({entry:[{changes:[{value:{metadata:{phone_number_id:phoneId},messages:[{id,from:phone.slice(1),timestamp:String(Math.floor(Date.now()/1000)),text:{body:text},type:"text"}]}}]}]});
  return fetch(base+webhook,{method:"POST",headers:{"Content-Type":"application/json","x-hub-signature-256":signature ? `sha256=${createHmac("sha256",appSecret).update(payload).digest("hex")}` : `sha256=${"0".repeat(64)}`},body:payload});
}
ok((await incoming("Forged",`forged-${suffix}`,false)).status,403,"webhook signature enforced");
ok((await incoming("Hello",`in-${suffix}`)).status,200,"signed incoming message accepted");
await incoming("Hello",`in-${suffix}`);
const messages = (await call(a,"/whatsapp/messages")).data.data;
ok(messages.filter(m=>m.provider_id===`in-${suffix}`).length,1,"webhook retry deduplicated");
await incoming("Wrong destination",`wrong-${suffix}`,true,"9999999999");
ok((await call(a,"/whatsapp/messages")).data.data.some(m=>m.provider_id===`wrong-${suffix}`),false,"mismatched business number ignored");
ok((await call(b,"/whatsapp/messages")).data.data.length,0,"WhatsApp messages isolated");
const schedulerBase = process.env.TEST_SCHEDULER_URL || "http://127.0.0.1:8789";
if (!["127.0.0.1","localhost"].includes(new URL(schedulerBase).hostname)) throw Error("Scheduler tests must be local.");
const rule = {enabled:true,interval_hours:24,next_due_at:new Date(Date.now()-60000).toISOString(),shared_update:"Approved public update",template_name:"case_update",template_language:"en_US"};
ok((await call(b,`/whatsapp/rules/${matter.data.id}`,{method:"PUT",body:rule})).status,404,"cross-firm schedule blocked");
ok((await call(a,`/whatsapp/rules/${matter.data.id}`,{method:"PUT",body:rule})).status,200,"create scheduled case update");
ok((await fetch(schedulerBase+"/__scheduled")).status,200,"Cloudflare scheduled handler executes");
const scheduled = (await call(a,"/whatsapp/messages")).data.data.filter(m=>m.actor==="Scheduled follow-up");
ok(scheduled.length,1,"due schedule creates one message");
ok(scheduled[0].status,"preview","scheduled preview never sends externally");
ok(scheduled[0].body.includes("Private test note"),false,"scheduled message excludes internal notes");
await fetch(schedulerBase+"/__scheduled");
ok((await call(a,"/whatsapp/messages")).data.data.filter(m=>m.actor==="Scheduled follow-up").length,1,"repeat scheduler invocation does not duplicate");
await incoming("STOP",`stop-${suffix}`);
ok((await call(a,"/whatsapp/messages",{method:"POST",body:message,headers:{"Idempotency-Key":randomUUID()}})).status,403,"STOP revokes messaging consent");
await call(a,`/whatsapp/rules/${matter.data.id}`,{method:"PUT",body:rule});
await fetch(schedulerBase+"/__scheduled");
ok((await call(a,"/whatsapp/messages")).data.data.filter(m=>m.actor==="Scheduled follow-up").length,1,"scheduler respects revoked consent");
const recovery = await call(a, "/account/recovery-code", { method: "POST", body: { password } });
ok(recovery.status, 200, "generate recovery code after password confirmation");
ok((await request("/api/account/recover", { method: "POST", body: { email: a.email, recoveryCode: recovery.data.code, password: password + "new" } })).status, 200, "account recovery");
ok((await call(a, "/workspace")).status, 401, "recovery revokes old browser sessions");
ok((await keyCall(writer.data.key, "/cases")).status, 401, "recovery revokes old API keys");
ok((await request("/api/account/recover", { method: "POST", body: { email: a.email, recoveryCode: recovery.data.code, password } })).status, 400, "recovery code cannot be reused");
console.log(`Verified ${checks} Cloudflare integration checks.`);
