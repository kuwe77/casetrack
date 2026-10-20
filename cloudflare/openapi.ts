const text = { type: "string" };
const uuid = { type: "string", format: "uuid" };
const nullableId = { anyOf: [uuid, { type: "null" }] };
const definitions = {
  cases: { ref: { ...text, maxLength:150 }, buyer: { ...text, maxLength:150 }, seller:text, property:text, type:{ enum:["Subsale","SPA","Loan","Refinance"] }, status:{ enum:["documents","spa","loan","redemption","stamping","disbursement","completed","on_hold"] }, priority:{enum:["normal","high"]}, agent_id:nullableId, owner:text, due_date:{anyOf:[{type:"string",format:"date"},{type:"null"}]}, next_step:text, notes:text, value:{type:"number",minimum:0} },
  agents: { name:text, email:text, phone:text, agency:text, color:{enum:["lime","blue","peach","lavender","green","rose","teal","amber","violet"]} },
  tasks: { case_id:nullableId, title:text, due_date:{anyOf:[{type:"string",format:"date"},{type:"null"}]}, assignee:text, completed:{type:"boolean"}, priority:{enum:["normal","high"]} },
};
const json = (schema: unknown) => ({ "application/json": { schema } });
const body = (schema: unknown) => ({ required: true, content: json(schema) });
const obj = (properties: unknown, required: string[] = []) => ({ type:"object", properties, required });
const pageParameters = [
  {name:"cursor",in:"query",schema:text,description:"Use nextCursor from the preceding response. Omit for the first page."},
  {name:"limit",in:"query",schema:{type:"integer",minimum:1,maximum:200,default:100},description:"Applies to cases, agents and tasks. Other paginated resources use 100."},
];
const idParameter = { name:"id",in:"path",required:true,schema:uuid };
function operation(summary: string, scope: string, schema: unknown = obj({}), code = "200") {
  return { summary, description:`Requires ${scope}. Keys can only access their own firm.`, "x-required-scope":scope,
    responses: {
      [code]:{description:"Success",content:json(schema)},
      "400":{description:"Invalid request"}, "401":{description:"Invalid, expired or revoked key"},
      "403":{description:"Missing scope or recipient consent"}, "404":{description:"Record not found in this firm"},
      "409":{description:"Record or idempotency conflict"}, "429":{description:"Rate limit reached; retry after one minute"},
    },
  };
}
export function openapi(origin: string) {
  const paths: Record<string, unknown> = {};
  paths["/me"]={get:{summary:"Read the key's identity, firm and granted scopes",responses:{"200":{description:"Identity",content:json(obj({userId:text,email:text,firmId:nullableId,role:text,scopes:{type:"array",items:text}}))}}}};
  paths["/workspace"]={get:operation("Read firm details","workspace:read",obj({firm:obj({id:uuid,name:text,email:text})}))};
  paths["/team"]={get:operation("Read firm member names and roles (no invitation secrets)","workspace:read",obj({members:{type:"array",items:obj({user_id:text,email:text,role:text})},invites:{type:"array",items:obj({})}}))};
  for (const [name, fields] of Object.entries(definitions)) {
    const record = obj({id:uuid,firm_id:uuid,...fields,created_at:{...text,format:"date-time"},...(name==="cases"?{updated_at:{...text,format:"date-time"}}:{})});
    paths[`/${name}`] = {
      get:{...operation(`List ${name}`,`${name}:read`,obj({data:{type:"array",items:record},nextCursor:{type:["string","null"]}})),parameters:pageParameters},
      post:{...operation(`Create ${name}`,`${name}:write`,record,"201"),requestBody:body(obj({id:uuid,...fields},name==="cases"?["ref","buyer"]:name==="agents"?["name"]:["title"]))},
    };
    paths[`/${name}/{id}`] = {
      parameters:[idParameter],get:operation(`Read ${name} record`,`${name}:read`,record),
      patch:{...operation(`Update ${name} record`,`${name}:write`,record),requestBody:body(obj(fields))},
    };
  }
  for (const resource of ["activities","documents","whatsapp/messages"]) {
    paths[`/${resource}`] = {get:{...operation(`List ${resource}`,`${resource==="whatsapp/messages"?"whatsapp":resource}:read`,obj({data:{type:"array",items:obj({})},nextCursor:{type:["string","null"]}})),parameters:pageParameters}};
  }
  paths["/cases/{id}/notes"] = {parameters:[idParameter],post:{...operation("Append a private case note","notes:write",obj({success:{type:"boolean"}}),"201"),requestBody:body(obj({note:{...text,maxLength:10000}},["note"]))}};
  paths["/cases/{id}/documents"] = {parameters:[idParameter],post:{...operation("Upload a private document (10 MB maximum; workspace and service allowances apply, exhausted allowance returns 413)","documents:write",obj({id:uuid,filename:text,size:{type:"integer"}}),"201"),requestBody:{required:true,content:{"multipart/form-data":{schema:obj({file:{type:"string",format:"binary"}},["file"])}}}}};
  paths["/documents/{id}/download"] = {parameters:[idParameter],get:{...operation("Download a private document","documents:read"),responses:{"200":{description:"Binary attachment",content:{"application/octet-stream":{schema:{type:"string",format:"binary"}}}}}}};
  (paths["/whatsapp/messages"] as Record<string,unknown>).post = {
    ...operation("Send or preview a WhatsApp message","whatsapp:write",obj({id:uuid,status:{enum:["preview","accepted","sent","delivered","read","failed","uncertain","sending","blocked"]}}),"201"),
    parameters:[{name:"Idempotency-Key",in:"header",required:true,schema:{...text,minLength:8,maxLength:128},description:"Reuse the same key for a retry. A replay returns 200 and the existing status. New keys must not start with the reserved schedule: or assistant: prefixes. Do not resend uncertain messages with a new key."}],
    requestBody:body(obj({phone:{...text,pattern:"^\\+[1-9]\\d{7,14}$"},body:{...text,minLength:1,maxLength:4096},case_id:nullableId,template:obj({name:text,language:text,parameters:{type:"array",items:text,maxItems:10}},["name","language"])},["phone","body"])),
  };
  paths["/whatsapp/rules"] = {get:operation("List scheduled follow-up rules","whatsapp:read",{type:"array",items:obj({})})};
  paths["/whatsapp/connection"]={get:operation("Read connection status without provider credentials","whatsapp:read",obj({provider:{enum:["meta","zernio"]},phone_number_id:text,account_label:text,enabled:{type:"integer"},dry_run:{type:"integer"}}))};
  paths["/whatsapp/contacts"]={get:operation("Read approved recipient details","whatsapp:read",{type:"array",items:obj({agent_id:uuid,phone:text,enabled:{type:"integer"},consent:{type:"integer"}})})};
  const inboxParameters=[pageParameters[0],{name:"limit",in:"query",schema:{type:"integer",minimum:1,maximum:100,default:50}}];
  const conversation=obj({id:text,accountId:text,participantId:text,participantName:text,lastMessage:text,updatedTime:text,unreadCount:{type:"integer"},status:text});
  const message=obj({id:text,body:text,direction:{enum:["incoming","outgoing"]},created_at:text,status:text,attachments:{type:"array",items:obj({type:text,url:text,name:text})}});
  paths["/whatsapp/conversations"]={get:{...operation("List connected Zernio WhatsApp conversations, newest first","whatsapp:read",obj({data:{type:"array",items:conversation},nextCursor:{type:["string","null"]}})),parameters:inboxParameters}};
  paths["/whatsapp/conversations/{id}/messages"]={parameters:[{name:"id",in:"path",required:true,schema:text,description:"Opaque conversation ID from the inbox. URL-encode it; it is not necessarily a UUID."}],get:{
    ...operation("Read a Zernio conversation and reconcile messages/delivery status into the firm log","whatsapp:read",obj({conversation,data:{type:"array",items:message},nextCursor:{type:["string","null"]}})),parameters:inboxParameters}};
  paths["/whatsapp/rules/{id}"] = {parameters:[{...idParameter,description:"Case ID"}],put:{
    ...operation("Create or replace a scheduled follow-up rule","whatsapp:write"),
    requestBody:body(obj({enabled:{type:"boolean"},interval_hours:{type:"integer",minimum:24,maximum:2160},next_due_at:{...text,format:"date-time"},shared_update:{...text,maxLength:800},template_name:text,template_language:text},["enabled","interval_hours","next_due_at","shared_update","template_name","template_language"])),
  }};
  const assistant = "/whatsapp/assistant", claimToken = { name:"X-Job-Token",in:"header",required:true,schema:{...text,pattern:"^[a-f0-9]{64}$"},description:"Secret from claim, bound to this job and API key." };
  const jobParameters = [idParameter, claimToken];
  paths[`${assistant}/poll`] = {get:operation("Check for an eligible agent question without provider calls or message data","assistant:reply",obj({action:{enum:["silent","wake"]},poll_after_seconds:{type:"integer",const:30}}))};
  paths[`${assistant}/claim`] = {post:operation("Claim one job for 10 minutes; job is null when none is available. One active job per firm.","assistant:reply",obj({job:{anyOf:[obj({id:uuid,token:text,lease_until:text}),{type:"null"}]},instructions:{type:"array",items:text}}))};
  paths[`${assistant}/jobs/{id}`] = {parameters:jobParameters,get:operation("Read only the verified sender's assigned case summaries and up to five grouped questions. No private notes or documents.","assistant:reply",obj({job_id:uuid,lease_until:text,context_version:text,context_revision:{type:"integer"},agent:obj({id:uuid,name:text}),questions:{type:"array",items:obj({id:uuid,question:text,received_at:text})},cases:{type:"array",items:obj({id:uuid,ref:text,type:text,status:text,due_date:{type:["string","null"]},shared_update:text})},instructions:{type:"array",items:text}}))};
  paths[`${assistant}/jobs/{id}/reply`] = {parameters:jobParameters,post:{
    ...operation("Reply to the fixed job recipient. Same body replays without resending. On context_changed, refetch and rewrite. Held/uncertain needs operator review.","assistant:reply",obj({state:text,message:obj({id:uuid,status:text})})),
    requestBody:body({...obj({body:{...text,minLength:1,maxLength:3000},context_version:{...text,pattern:"^[a-f0-9]{64}$"}},["body","context_version"]),additionalProperties:false}),
  }};
  paths[`${assistant}/jobs/{id}/heartbeat`] = {parameters:jobParameters,post:operation("Extend an unexpired processing claim by ten minutes","assistant:reply",obj({lease_until:text}))};
  paths[`${assistant}/jobs/{id}/skip`] = {parameters:jobParameters,post:operation("Close a processing job without sending a message","assistant:reply",obj({success:{type:"boolean"}}))};
  paths[`${assistant}/jobs/{id}/status`] = {parameters:jobParameters,get:operation("Read this claim's processing and delivery status, including after completion","assistant:reply",obj({state:text,delivery_status:{type:["string","null"]}}))};
  return {openapi:"3.1.0",info:{title:"CaseTrack Agent API",version:"1.2.0",description:"Create general API keys in Settings. For Muse replies use the dedicated assistant:reply key from WhatsApp; it must have no other scope and cannot read the general inbox or case APIs. Setup: /muse/SETUP.md. HTTPS and Authorization: Bearer ct_… required. Keys expire, are revocable, and cannot manage accounts, members, credentials or provider settings. Record and inbox collections use {data,nextCursor}; follow cursors until null for a full export. Team/workspace/connection return objects; WhatsApp rules/contacts return arrays. Record lists are ordered by UUID; Zernio inbox/messages are newest first. Notes are in case.notes and note-kind activities. Provider history availability and rate limits apply. No CORS access is enabled."},servers:[{url:`${origin}/api/v1`}],security:[{bearerAuth:[]}],components:{securitySchemes:{bearerAuth:{type:"http",scheme:"bearer"}}},paths};
}
