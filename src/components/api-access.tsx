import { useEffect, useState, type FormEvent } from "react";
import { api, send } from "../lib/api";
import { errorMessage } from "../lib/repository";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card } from "./ui/card";
const resources = ["cases", "agents", "tasks", "documents", "whatsapp"];
const scopes = ["workspace:read", ...resources.flatMap(r => [`${r}:read`, `${r}:write`]), "activities:read", "notes:write"];
interface Key { id: string; name: string; prefix: string; scopes: string[]; expires_at: string; last_used_at: string | null; revoked_at: string | null }
export function ApiAccess() {
  const [keys, setKeys] = useState<Key[]>([]), [selected, setSelected] = useState(["cases:read"]), [secret, setSecret] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const refresh = () => api<Key[]>("/keys").then(setKeys);
  useEffect(() => { void refresh().catch(e => setError(errorMessage(e))); }, []);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(""); setSecret("");
    const data = new FormData(e.currentTarget);
    try {
      const result = await send<{ key: string }>("/keys", { name: data.get("name"), days: Number(data.get("days")), scopes: selected });
      setSecret(result.key); await refresh();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Card className="panel settings-panel"><h2>API access for your agents</h2><p className="vault-help">Each key is restricted to this firm and your membership. Write permissions let connected agents change records or send WhatsApp messages. Give each integration its own key.</p>
    <a href="/api-docs.html" target="_blank" rel="noreferrer" className="text-link">Read API documentation ↗</a>
    <form className="vault-form mt-5" onSubmit={create}><label>Key name<Input name="name" required maxLength={100} placeholder="My case assistant"/></label><label>Expires in days<Input type="number" name="days" min={1} max={365} defaultValue={90} required/></label>
      <fieldset><legend>Permissions</legend><div className="grid grid-cols-2 gap-3 mt-3">{scopes.map(s => <label className="wa-check" key={s}><input type="checkbox" checked={selected.includes(s)} onChange={e => setSelected(e.target.checked ? [...selected, s] : selected.filter(x => x !== s))}/>{s}</label>)}</div></fieldset>
      <Button disabled={busy || !selected.length}>Create API key</Button>
    </form>
    {secret && <div className="wa-token"><strong>Copy your key now. It won’t be shown again.</strong><code className="block break-all select-all my-3">{secret}</code><Button variant="outline" onClick={() => void navigator.clipboard.writeText(secret).catch(() => setError("Select the key and copy it manually."))}>Copy key</Button><Button variant="ghost" onClick={() => setSecret("")}>Dismiss</Button></div>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="mt-6">{keys.map(k => <div className="team-row" key={k.id}><span><strong>{k.name}</strong><small>{k.prefix}… · {k.revoked_at ? "Revoked" : `Expires ${new Date(k.expires_at).toLocaleDateString()}`}</small><small>{k.scopes.join(", ")}</small><small>Last used: {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "Never"}</small></span>{!k.revoked_at && <Button variant="outline" disabled={busy} onClick={async () => {
      setBusy(true); setError(""); try { await api(`/keys/${k.id}`, { method: "DELETE" }); await refresh(); } catch(e) { setError(errorMessage(e)); } finally { setBusy(false); }
    }}>Revoke</Button>}</div>)}</div>
  </Card>;
}
