import { useEffect, useRef, useState } from "react";
import { api, send } from "../lib/api";
import { errorMessage } from "../lib/repository";
import type { Workspace } from "../lib/model";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { WhatsAppRules } from "./whatsapp-rules";
import { WhatsAppInbox } from "./whatsapp-inbox";
import { ReplyAssistant } from "./reply-assistant";
type Settings = { provider?: "meta"|"zernio"; phone_number_id: string; enabled: number; dry_run: number; has_token: boolean; has_secret: boolean; zernio_account_id?:string;has_zernio_key?:boolean;account_label?:string };
type Contact = { agent_id: string; phone: string; enabled: number; consent: number };
type Message = { id: string; phone: string; body: string; direction: string; status: string; created_at: string };
export function WhatsAppPage({ w }: { w: Workspace }) {
  const outgoing = useRef({ payload: "", key: "" });
  const [provider,setProvider]=useState<"meta"|"zernio">("meta"),[recipient,setRecipient]=useState("");
  const [settings, setSettings] = useState<Settings>({ phone_number_id: "", enabled: 0, dry_run: 1, has_token: false, has_secret: false });
  const [contacts, setContacts] = useState<Contact[]>([]), [messages, setMessages] = useState<Message[]>([]);
  const [webhook, setWebhook] = useState(""), [verifyToken, setVerifyToken] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [owner, setOwner] = useState(false);
  async function refresh() {
    const me = await api<{ role: string }>("/me"); setOwner(me.role === "owner");
    if (me.role === "owner") {
      const result = await api<{ settings: Settings; contacts: Contact[]; webhook: string }>("/whatsapp/settings");
      setSettings(result.settings); setProvider(result.settings.provider||"meta"); setContacts(result.contacts); setWebhook(result.webhook);
    }
    let cursor: string | null = "", all: Message[] = [];
    do {
      const result: { data: Message[]; nextCursor: string | null } = await api(`/whatsapp/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      all = all.concat(result.data); cursor = result.nextCursor;
    } while (cursor);
    setMessages(all.sort((a,b) => b.created_at.localeCompare(a.created_at)));
  }
  useEffect(() => { void refresh().catch(e => setError(errorMessage(e))); }, []);
  async function act(work: () => Promise<unknown>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try { await work(); await refresh(); setNotice(message); } catch(e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <><div className="page-heading"><div><span className="eyebrow">Firm communication</span><h1>WhatsApp</h1><p>Conversations and case updates, connected to your workspace.</p></div><Button variant="outline" onClick={() => void act(refresh, "Refreshed")} disabled={busy}>Refresh</Button></div>
    {error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status" className="wa-notice">{notice}</p>}
    {owner && <div className="wa-layout"><Card className="wa-card"><h2>WhatsApp Business connection</h2><p>Connect through Zernio or the Meta Cloud API. Provider fees and approval requirements apply separately. Saved credentials are encrypted and never returned to the browser.</p>
      <form className="wa-form" onSubmit={e => {
        e.preventDefault(); const data = new FormData(e.currentTarget);
        void act(async () => {
          const result = await send<{ verifyToken?: string }>("/whatsapp/settings", provider==="zernio" ? {
            provider:"zernio",zernio_account_id:data.get("zernio_account_id"),zernio_api_key:data.get("zernio_api_key")||undefined,
            enabled:data.has("enabled"),dry_run:data.has("dry_run"),
          } : {
            provider:"meta",
            phone_number_id: data.get("phone_number_id"), access_token: data.get("access_token") || undefined,
            app_secret: data.get("app_secret") || undefined, enabled: data.has("enabled"), dry_run: data.has("dry_run"),
          }, "PUT");
          if (result.verifyToken) setVerifyToken(result.verifyToken);
        }, "Connection saved");
      }} key={`${settings.phone_number_id}:${settings.enabled}:${settings.dry_run}`}>
        <label className="field"><span>Provider</span><select name="provider" value={provider} onChange={e=>setProvider(e.target.value as "meta"|"zernio")}><option value="meta">Meta Cloud API</option><option value="zernio">Zernio</option></select></label>
        {provider==="zernio"?<>
          <label className="field"><span>Zernio account ID</span><Input name="zernio_account_id" defaultValue={settings.zernio_account_id||""} required /></label>
          <label className="field"><span>Zernio API key {settings.has_zernio_key&&"(saved; leave blank to retain)"}</span><Input name="zernio_api_key" type="password" autoComplete="off" /></label>
          {settings.provider==="zernio"&&<p className="vault-help">{settings.account_label} · {settings.phone_number_id}</p>}
        </>:<><label className="field"><span>Phone number ID</span><Input name="phone_number_id" defaultValue={settings.provider==="zernio"?"":settings.phone_number_id} required pattern="[0-9]{5,30}" /></label>
        <label className="field"><span>Access token {settings.has_token && "(saved; leave blank to retain)"}</span><Input name="access_token" type="password" autoComplete="off" /></label>
        <label className="field"><span>Meta app secret {settings.has_secret && "(saved; leave blank to retain)"}</span><Input name="app_secret" type="password" autoComplete="off" /></label></>}
        <label className="wa-check"><input name="enabled" type="checkbox" defaultChecked={!!settings.enabled}/>Enable messaging</label>
        <label className="wa-check"><input name="dry_run" type="checkbox" defaultChecked={!!settings.dry_run}/>Preview only: record messages without sending</label>
        <Button disabled={busy}>Save connection</Button>
      </form>
    </Card><Card className="wa-card"><h2>Receive messages</h2>{settings.provider==="zernio"?<p>Your connected inbox retrieves conversations, incoming messages, attachments and delivery statuses from Zernio. Use Refresh inbox to retrieve new replies, or let your agent poll the paginated API. Existing Zernio automations are unchanged.</p>:<><p>Add this callback URL in your Meta app, verify it, and subscribe to the messages webhook.</p><code className="break-all select-all">{webhook}</code><Button className="mt-4" variant="outline" disabled={busy} onClick={() => void act(async () => {
      const r = await send<{ verifyToken: string }>("/whatsapp/verification-token", {}); setVerifyToken(r.verifyToken);
    }, "New verification token generated")}>Generate verification token</Button>
      {verifyToken && <div className="wa-token"><p>Copy this into Meta’s verification token field.</p><code className="break-all select-all">{verifyToken}</code><Button variant="ghost" onClick={() => setVerifyToken("")}>Dismiss</Button></div>}</>}
      <h3 className="mt-6">Connect your AI agent</h3><p>Use Agent replies with Muse below for questions from property agents. Its restricted key only accesses the sender’s assigned case summaries.</p><a className="text-link" href="/api-docs.html">API documentation ↗</a><p className="vault-help">Incoming STOP, CANCEL or UNSUBSCRIBE messages disable recipient consent.</p>
    </Card></div>}
    {owner && <Card className="wa-card"><h2>Approved recipients</h2><p>Verify the contact’s number and obtain consent before enabling messages.</p>{w.agents.map(a => {
      const existing = contacts.find(x => x.agent_id === a.id);
      return <form className="wa-contact" key={`${a.id}:${JSON.stringify(existing)}`} onSubmit={e => {
        e.preventDefault(); const data = new FormData(e.currentTarget);
        void act(() => send(`/whatsapp/contacts/${a.id}`, { phone: data.get("phone"), enabled: data.has("enabled"), consent: data.has("consent") }, "PUT"), "Recipient saved");
      }}><strong>{a.name}</strong><label className="field"><span>International number</span><Input name="phone" required pattern="\+[1-9][0-9]{7,14}" defaultValue={existing?.phone || a.phone} placeholder="+60123456789"/></label><label className="wa-check"><input type="checkbox" name="enabled" defaultChecked={!!existing?.enabled}/>Verified</label><label className="wa-check"><input type="checkbox" name="consent" defaultChecked={!!existing?.consent}/>Consent</label><Button variant="outline" disabled={busy}>Save</Button></form>;
    })}{!w.agents.length && <p className="vault-help">Add a contact in Agents first.</p>}</Card>}
    {owner && settings.provider === "zernio" && <ReplyAssistant key={`assistant:${settings.enabled}:${settings.zernio_account_id}`}/>}
    <WhatsAppInbox key={`${settings.provider}:${settings.zernio_account_id}`} onRecipient={setRecipient}/>
    {owner && <WhatsAppRules w={w}/>}<Card className="wa-card"><h2>Compose an update</h2><p>Free-text replies require an incoming message within the last 23 hours. Use the API with an approved template outside that window.</p><form className="wa-form" onSubmit={e => {
      e.preventDefault(); const form = e.currentTarget, data = new FormData(form);
      void act(async () => {
        const payload = JSON.stringify({ phone: data.get("phone"), body: data.get("body"), case_id: data.get("case_id") || null });
        if (outgoing.current.payload !== payload) outgoing.current = { payload, key: crypto.randomUUID() };
        const result = await api<{ status: string }>("/whatsapp/messages", { method: "POST", headers: { "Idempotency-Key": outgoing.current.key }, body: payload });
        if (["failed","uncertain"].includes(result.status)) throw Error(`Message ${result.status}. Check provider status before sending again.`);
        form.reset();setRecipient(""); outgoing.current = { payload: "", key: "" };
      }, "Message processed. Check its status below.");
    }}><label className="field"><span>Recipient</span><Input name="phone" value={recipient} onChange={e=>setRecipient(e.target.value)} required pattern="\+[1-9][0-9]{7,14}" placeholder="+60123456789"/></label><label className="field"><span>Related case</span><select name="case_id"><option value="">General message</option>{w.cases.map(c => <option value={c.id} key={c.id}>{c.ref}</option>)}</select></label><label className="field"><span>Message</span><Textarea name="body" required maxLength={4096} rows={3}/></label><Button disabled={busy}>Send / preview message</Button></form></Card>
    <Card className="wa-card"><h2>CaseTrack message log</h2><p>Accepted means the provider received the request. Delivery and read statuses come from the Meta webhook or refreshing the Zernio conversation.</p><div className="wa-events">{messages.map(m => <article key={m.id}><div className="wa-event-head"><strong>{m.phone} · {m.direction}</strong><span>{m.status}</span></div><small>{new Date(m.created_at).toLocaleString()}</small><p className="wa-response">{m.body}</p></article>)}</div>{!messages.length && <p className="vault-help">No messages yet.</p>}</Card>
  </>;
}
