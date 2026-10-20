// Explicit, opt-in live smoke test. Synthetic records only; never sends WhatsApp.
// Saves IDs and credentials under ignored .wrangler/ for UI verification and scoped cleanup.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const base = process.env.SMOKE_ORIGIN;
if (!base || new URL(base).protocol !== "https:") throw Error("Set SMOKE_ORIGIN to the exact deployed HTTPS origin.");
const file = ".wrangler/production-smoke.json";
let state;
try { state = JSON.parse(await readFile(file,"utf8")); } catch { state = { origin:base,email:`smoke-${randomUUID()}@example.test`,password:randomBytes(24).toString("hex") }; }
if (state.origin !== base) throw Error("Previous smoke state belongs to a different origin.");
const save = () => writeFile(file,JSON.stringify(state));
async function call(path,{method="GET",body,key}={}) {
  const response = await fetch(base+path,{method,headers:{Origin:base,...(body && !(body instanceof FormData)?{"Content-Type":"application/json"}:{}),...(key?{Authorization:`Bearer ${key}`}:(state.cookie?{Cookie:state.cookie}:{}))},body:body?(body instanceof FormData?body:JSON.stringify(body)):undefined});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  assert.ok(response.ok,`${path}: HTTP ${response.status} ${typeof data==="object"?JSON.stringify(data):String(data).slice(0,150)}`);
  console.log(`PASS ${method} ${path}`);
  return {data,cookie:response.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ")};
}
await save();
if (!state.userId) {
  const r=await call("/api/auth/sign-up/email",{method:"POST",body:{name:"CaseTrack deployment test",email:state.email,password:state.password}});
  state.userId=r.data.user.id;state.cookie=r.cookie;await save();
}
const login=await call("/api/auth/sign-in/email",{method:"POST",body:{email:state.email,password:state.password}});
state.cookie=login.cookie;await save();
assert.ok(state.cookie,"Login must issue a session cookie.");
await call("/api/auth/get-session");
if (!state.firmId) {state.firmId=(await call("/api/v1/workspace",{method:"POST",body:{name:"Deployment test — synthetic data"}})).data.id;await save();}
if (!state.caseId) {state.caseId=(await call("/api/v1/cases",{method:"POST",body:{ref:"SMOKE-"+randomUUID().slice(0,8),buyer:"Synthetic buyer",property:"Test data — no client records"}})).data.id;await save();}
if (!state.key) {state.key=(await call("/api/v1/keys",{method:"POST",body:{name:"Deployment test",scopes:["cases:read","cases:write","documents:read","documents:write"],days:1}})).data.key;await save();}
await call("/api/v1/cases",{key:state.key});
await call(`/api/v1/cases/${state.caseId}`,{key:state.key,method:"PATCH",body:{status:"spa"}});
const health=(await call("/api/health")).data;
if (health.files && !state.documentId) {
  const data=new FormData();data.set("file",new File(["Synthetic deployment test."],"smoke.txt",{type:"text/plain"}));
  state.documentId=(await call(`/api/v1/cases/${state.caseId}/documents`,{key:state.key,method:"POST",body:data})).data.id;await save();
  assert.equal((await call(`/api/v1/documents/${state.documentId}/download`,{key:state.key})).data,"Synthetic deployment test.");
}
console.log(health.files ? "Production account, API and private storage smoke test passed." : "Production account and API smoke test passed. Storage is not enabled.");
