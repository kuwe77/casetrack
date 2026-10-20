import { useEffect, useState } from "react";
import type { Workspace } from "../lib/model";
import { api, send } from "../lib/api";
import { errorMessage } from "../lib/repository";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
interface Rule { case_id: string; enabled: number; interval_hours: number; next_due_at: string; shared_update: string; template_name: string; template_language: string }
export function WhatsAppRules({ w }: { w: Workspace }) {
  const [rules,setRules] = useState<Rule[]>([]), [error,setError] = useState(""), [notice,setNotice] = useState(""), [busy,setBusy] = useState(false);
  const refresh = () => api<Rule[]>("/whatsapp/rules").then(setRules);
  useEffect(() => { void refresh().catch(e=>setError(errorMessage(e))); },[]);
  return <Card className="wa-card"><h2>Scheduled case updates</h2><p>Scheduled updates are checked every five minutes. Only enabled, consenting recipients receive updates. Completed and on-hold cases are skipped. Templates must be approved by Meta and accept one body parameter containing the case update.</p>
    {w.cases.map(c => { const r=rules.find(r=>r.case_id===c.id); return <details className="wa-rule" key={`${c.id}:${JSON.stringify(r)}`}><summary>{c.ref}<span>{r?.enabled ? "Scheduled" : "Off"}</span></summary><form className="wa-form" onSubmit={async e=>{
      e.preventDefault(); const d=new FormData(e.currentTarget); setBusy(true); setError(""); setNotice("");
      try { await send(`/whatsapp/rules/${c.id}`,{enabled:d.has("enabled"),interval_hours:Number(d.get("interval")),next_due_at:new Date(String(d.get("next"))).toISOString(),shared_update:d.get("update"),template_name:d.get("template"),template_language:d.get("language")},"PUT"); await refresh(); setNotice("Follow-up rule saved.");}
      catch(e){setError(errorMessage(e));}finally{setBusy(false);}
    }}><label className="wa-check"><input type="checkbox" name="enabled" defaultChecked={!!r?.enabled}/>Enable scheduled updates</label><div className="wa-fields">
      <label className="field"><span>Repeat every (hours)</span><Input type="number" name="interval" min={24} max={2160} defaultValue={r?.interval_hours||72} required/></label>
      <label className="field"><span>Next update</span><Input type="datetime-local" name="next" defaultValue={new Date(new Date(r?.next_due_at||Date.now()).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)} required/></label>
    </div><label className="field"><span>Approved shared update</span><Textarea name="update" defaultValue={r?.shared_update||""} maxLength={800}/></label><div className="wa-fields">
      <label className="field"><span>Approved template name</span><Input name="template" defaultValue={r?.template_name||""} pattern="[a-z0-9_]+" required/></label>
      <label className="field"><span>Template language</span><Input name="language" defaultValue={r?.template_language||"en_US"} required/></label>
    </div><Button disabled={busy}>Save rule</Button></form></details>; })}
    {error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </Card>;
}
