import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight } from "@phosphor-icons/react";
import { api, send } from "../lib/api";
import { errorMessage } from "../lib/repository";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const resources = [
  { id: "workspace", label: "Workspace", read: true, write: false },
  { id: "cases", label: "Cases", read: true, write: true },
  { id: "agents", label: "Property agents", read: true, write: true },
  { id: "tasks", label: "Follow-ups", read: true, write: true },
  { id: "documents", label: "Documents", read: true, write: true },
  { id: "whatsapp", label: "WhatsApp", read: true, write: true },
  { id: "activities", label: "Activity history", read: true, write: false },
  { id: "notes", label: "Notes", read: false, write: true },
];
const scopes = resources.flatMap(r => [r.read && `${r.id}:read`, r.write && `${r.id}:write`].filter((s): s is string => !!s));
interface Key { id: string; name: string; prefix: string; scopes: string[]; expires_at: string; last_used_at: string | null; revoked_at: string | null }
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
function scopeLabel(scope: string) {
  if (scope === "assistant:reply") return "Agent replies · Assigned cases only";
  const [resource, action] = scope.split(":");
  return `${resources.find(r => r.id === resource)?.label || resource} · ${action === "write" ? "Write" : "Read"}`;
}

export function ApiAccess() {
  const [keys, setKeys] = useState<Key[]>([]), [selected, setSelected] = useState(["cases:read"]), [secret, setSecret] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const refresh = () => api<Key[]>("/keys").then(setKeys);
  useEffect(() => { void refresh().catch(e => setError(errorMessage(e))).finally(() => setLoading(false)); }, []);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(""); setSecret(""); setCopied(false);
    const data = new FormData(e.currentTarget);
    try {
      const result = await send<{ key: string }>("/keys", { name: data.get("name"), days: Number(data.get("days")), scopes: selected });
      setSecret(result.key); await refresh();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true); setError("");
    try { await api(`/keys/${id}`, { method: "DELETE" }); await refresh(); }
    catch(e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  function keyRow(key: Key) {
    const expired = new Date(key.expires_at) <= new Date();
    return <li className="api-key-row" key={key.id}>
      <div className="api-key-details">
        <div className="api-key-title"><strong>{key.name}</strong><span className="api-key-status">{key.revoked_at ? "Revoked" : expired ? "Expired" : "Active"}</span></div>
        <p><code>{key.prefix}…</code><span>{key.revoked_at ? `Revoked ${date(key.revoked_at)}` : `Expires ${date(key.expires_at)}`}</span><span>Last used {key.last_used_at ? date(key.last_used_at) : "never"}</span></p>
        <details className="api-key-permissions"><summary>{key.scopes.length} permissions</summary><ul>{key.scopes.map(scope => <li key={scope}>{scopeLabel(scope)}</li>)}</ul></details>
      </div>
      {!key.revoked_at && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void revoke(key.id)}>Revoke</Button>}
    </li>;
  }
  const currentKeys = keys.filter(k => !k.revoked_at);
  const revokedKeys = keys.filter(k => k.revoked_at);
  return <section className="api-access">
    <header className="settings-section-header settings-header-with-link">
      <div><h2>API access</h2><p>Connect an assistant or integration to this firm. Give each integration its own key.</p></div>
      <a href="/api-docs.html" target="_blank" rel="noreferrer" className="settings-docs-link">API documentation<ArrowUpRight size={15}/></a>
    </header>
    <form className="settings-form api-key-form" onSubmit={create}>
      <div className="settings-field-pair">
        <label className="settings-field"><span>Key name</span><Input name="name" required maxLength={100} placeholder="My case assistant" disabled={busy}/></label>
        <label className="settings-field"><span>Expires in days</span><Input type="number" name="days" min={1} max={365} defaultValue={90} required disabled={busy}/></label>
      </div>
      <fieldset className="api-permissions" disabled={busy}>
        <legend>Permissions</legend>
        <div className="api-permissions-toolbar">
          <span role="status" aria-live="polite">{selected.length} of {scopes.length} selected</span>
          <div><Button type="button" variant="outline" size="sm" onClick={() => setSelected([...scopes])} disabled={busy || selected.length === scopes.length}>Select all</Button><Button type="button" variant="ghost" size="sm" onClick={() => setSelected([])} disabled={busy || !selected.length}>Clear all</Button></div>
        </div>
        <div className="api-permissions-table">
          <table>
            <thead><tr><th scope="col">Resource</th><th scope="col">Read</th><th scope="col">Write</th></tr></thead>
            <tbody>{resources.map(resource => <tr key={resource.id}>
              <th scope="row">{resource.label}</th>
              {(["read", "write"] as const).map(action => {
                const scope = `${resource.id}:${action}`;
                return <td key={action}>{resource[action] ? <label className="api-permission-check"><input type="checkbox" aria-label={`${action === "read" ? "Read" : "Write"} ${resource.label.toLowerCase()}`} checked={selected.includes(scope)} onChange={e => setSelected(current => e.target.checked ? [...current, scope] : current.filter(s => s !== scope))}/></label> : <span className="api-permission-unavailable" aria-label="Not available">—</span>}</td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>
        <p className="settings-help">Read allows viewing. Write allows edits, uploads or WhatsApp messages. Keys are limited to this firm and your membership.</p>
      </fieldset>
      <div className="settings-actions"><Button disabled={busy || !selected.length}>{busy ? "Working…" : "Create API key"}</Button></div>
    </form>
    {secret && <div className="settings-secret" role="status"><strong>Copy your key now. It won’t be shown again.</strong><code>{secret}</code><div className="settings-actions"><Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText(secret).then(() => setCopied(true)).catch(() => setError("Select the key and copy it manually."))}>{copied ? "Copied" : "Copy key"}</Button><Button type="button" variant="ghost" onClick={() => setSecret("")}>Dismiss</Button></div></div>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <section className="api-existing-keys" aria-label="Existing API keys">
      <h3>Your API keys</h3>
      {loading ? <p className="settings-help" role="status">Loading keys…</p> : currentKeys.length ? <ul className="api-key-list">{currentKeys.map(keyRow)}</ul> : <p className="settings-help">No current keys. Create one above to connect an integration.</p>}
      {!!revokedKeys.length && <details className="api-revoked-keys"><summary>Revoked keys ({revokedKeys.length})</summary><ul className="api-key-list">{revokedKeys.map(keyRow)}</ul></details>}
    </section>
  </section>;
}
