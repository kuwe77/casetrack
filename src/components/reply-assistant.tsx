import { useEffect, useState } from "react";
import { api, send } from "../lib/api";
import { errorMessage } from "../lib/repository";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";

type Settings = {
  enabled: number; daily_limit: number; webhook_id: string | null; last_poll_at: string | null; last_event_at: string | null;
  counts: { state: string; count: number }[];
  recent: { id: string; name: string; question: string; state: string; kind: string; review_reason: string | null; delivery_status: string | null; created_at: string }[];
};
const path = "/whatsapp/assistant";
const time = (date: string | null) => date ? new Date(date).toLocaleString() : "Not yet";
export function ReplyAssistant() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [key, setKey] = useState("");
  const refresh = () => api<Settings>(`${path}/settings`).then(setSettings);
  useEffect(() => { void refresh().catch(e => setError(errorMessage(e))); }, []);
  async function act(work: () => Promise<unknown>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try { await work(); await refresh(); setNotice(message); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Card className="wa-card">
    <div className="wa-event-head"><div><h2>Agent replies with Muse</h2><p>Approved property agents can ask about their own cases. Muse receives only their assigned case summaries and shared updates.</p></div>
      <Button variant="outline" disabled={busy} onClick={() => void act(refresh, "Status refreshed")}>Refresh status</Button></div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status" className="wa-notice">{notice}</p>}
    {settings && <>
      <form className="wa-form" key={`${settings.enabled}:${settings.daily_limit}`} onSubmit={e => {
        e.preventDefault(); const form = new FormData(e.currentTarget);
        void act(() => send(`${path}/settings`, { enabled: form.has("enabled"), daily_limit: Number(form.get("daily_limit")) }, "PUT"), "Reply preferences saved");
      }}>
        <label className="wa-check"><input type="checkbox" name="enabled" defaultChecked={!!settings.enabled}/>Enable Muse replies and configured stage updates</label>
        <label className="field"><span>Maximum Muse messages per day</span><Input type="number" name="daily_limit" min={1} max={300} defaultValue={settings.daily_limit} required/></label>
        <p className="vault-help">One job at a time. Pausing cancels waiting questions and stage updates. The daily limit and “Preview only” option apply to both. Daily allowance resets at midnight UTC.</p>
        <Button disabled={busy}>Save reply preferences</Button>
      </form>
      <div className="settings-actions mt-4">
        <Button variant="outline" disabled={busy} onClick={() => void act(async () => {
          await send(`${path}/settings`, { enabled: !!settings.enabled, daily_limit: settings.daily_limit }, "PUT");
          await send(`${path}/connect`, {});
        }, "Incoming messages connected")}>{settings.webhook_id ? "Reconnect incoming messages" : "Connect incoming messages"}</Button>
        <Button variant="outline" disabled={busy} onClick={() => void act(async () => {
          const result = await send<{ key: string }>("/keys", { name: "Muse reply assistant", days: 90, scopes: ["assistant:reply"] });
          setKey(result.key);
        }, "Restricted key created. Copy it once, then give it to Muse securely.")}>Create Muse key</Button>
        <a className="text-link" href="/muse/SETUP.md" target="_blank" rel="noreferrer">Muse setup guide ↗</a>
      </div>
      {key && <div className="wa-token"><p>This key can only work on queued agent replies and enabled stage updates. It expires in 90 days; revoke it in Settings → API access.</p>
        <code className="break-all select-all">{key}</code>
        <Button variant="outline" onClick={() => void navigator.clipboard.writeText(key).then(() => setNotice("Key copied")).catch(() => setError("Select and copy the key above."))}>Copy key</Button>
        <Button variant="ghost" onClick={() => setKey("")}>Hide key</Button></div>}
      <p className="vault-help">Incoming connection: {settings.webhook_id ? "Connected" : "Not connected"} · Last message: {time(settings.last_event_at)} · Last Muse check: {time(settings.last_poll_at)}</p>
      <p className="vault-help">Connect Muse using the guide before expecting replies. Unknown numbers receive no automatic reply. Private notes, documents and other agents’ cases are excluded.</p>
      {!!settings.recent.length && <details className="mt-4"><summary>Recent Muse messages</summary><div className="wa-events">{settings.recent.map(job => <article key={job.id}>
        <div className="wa-event-head"><strong>{job.name}</strong><span>{job.delivery_status || job.state}</span></div>
        <small>{time(job.created_at)}</small><p className="wa-response">{job.question}</p>
        {job.state === "held" && <p className="vault-help">Needs review. {job.review_reason} Check the conversation before sending manually; this message will not be sent again automatically.</p>}
      </article>)}</div></details>}
    </>}
  </Card>;
}
