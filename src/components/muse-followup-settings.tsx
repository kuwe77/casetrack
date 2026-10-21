import { useEffect, useState } from "react";
import { api, send } from "../lib/api";
import { errorMessage } from "../lib/repository";
import { Button } from "./ui/button";
import "./stage-notifications.css";

type Config = { enabled: number; template_name: string; template_language: string; owner: boolean };
type Template = { name: string; language: string; status: string; text: string };
const path = "/whatsapp/assistant/followups";
export function MuseFollowupSettings() {
  const [config, setConfig] = useState<Config | null>(null), [templates, setTemplates] = useState<Template[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => { let active = true;
    void api<Config>(`${path}/settings`).then(async result => {
      if (!active) return; setConfig(result);
      if (result.owner) { const values = await api<Template[]>(`${path}/templates`); if (active) setTemplates(values); }
    }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, []);
  const selected = templates.find(t => t.name === config?.template_name && t.language === config?.template_language);
  return <section className="muse-followup-section" aria-labelledby="stage-settings-heading">
    <header className="settings-section-header"><h2 id="stage-settings-heading">WhatsApp updates at selected stages</h2>
      <p>Open a case → Notify agent on progress. The clerk can choose stages and customize the message for that case’s assigned agent. Muse sends the update when the case enters a selected stage.</p></header>
    {config?.owner ? <form className="settings-form settings-form-narrow" onSubmit={e => { e.preventDefault(); setBusy(true); setError(""); setNotice("");
      void send(`${path}/settings`, { enabled: !!config.enabled, template_name: config.template_name, template_language: config.template_language }, "PUT")
        .then(() => setNotice("Stage notification settings saved.")).catch(e => setError(errorMessage(e))).finally(() => setBusy(false));
    }}>
      <label className="stage-check"><input type="checkbox" checked={!!config.enabled} disabled={busy} onChange={e => setConfig({ ...config, enabled: Number(e.target.checked) })}/>Allow case-stage notifications with Muse</label>
      <label className="settings-field"><span>Template for agents who haven’t messaged recently</span><select value={config.template_name ? `${config.template_name}:${config.template_language}` : ""} disabled={busy} onChange={e => {
        const [name, language] = e.target.value.split(":"); setConfig({ ...config, template_name: name, template_language: language || "en" });
      }}><option value="">Only use an open reply window</option>
        {config.template_name && !selected && <option value={`${config.template_name}:${config.template_language}`}>{config.template_name} · unavailable</option>}
        {templates.map(t => <option key={`${t.name}:${t.language}`} value={`${t.name}:${t.language}`}>{t.name} · {t.language} · {t.status.toLowerCase()}</option>)}
      </select></label>
      <p className="settings-help">Outside WhatsApp’s reply window, an approved template is required and WhatsApp template charges may apply. Otherwise the update is held for review. {selected && `Selected template: ${selected.status.toLowerCase()}.`}</p>
      <div className="settings-actions"><Button disabled={busy}>{busy ? "Saving…" : "Save stage settings"}</Button><span role="status">{notice}</span></div>
    </form> : config && <p className="settings-help">Stage notifications are {config.enabled ? "enabled" : "paused"}. Only the workspace owner changes this setting; team members can choose the stages on each case.</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <p className="settings-help mt-4">The main Muse assistant must also be enabled under WhatsApp. Notifications share its daily message limit and preview setting. Update Muse with the prompt below before expecting stage notifications.</p>
  </section>;
}
