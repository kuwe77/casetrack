import { useEffect, useState } from "react";
import { api, send } from "../lib/api";
import { stages, type CaseRecord } from "../lib/model";
import { errorMessage } from "../lib/repository";
import { Button } from "./ui/button";
import "./stage-notifications.css";

type Rule = { stage: string; enabled: boolean; message: string };
type Result = { rules: { stage: string; enabled: number; message: string }[]; contact_ready: boolean; enabled: boolean;
  jobs: { stage: string; state: string; delivery_status: string | null; review_reason: string | null }[] };
export function StageNotifications({ record, agentName }: { record: CaseRecord; agentName?: string }) {
  const [data, setData] = useState<Result | null>(null), [rules, setRules] = useState<Rule[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const path = `/cases/${record.id}/stage-notifications`;
  useEffect(() => {
    let active = true;
    setData(null); setError(""); setSaved(false);
    api<Result>(path).then(result => {
      if (!active) return;
      setData(result);
      setRules(stages.map(stage => {
        const rule = result.rules.find(r => r.stage === stage.id);
        return { stage: stage.id, enabled: !!rule?.enabled, message: rule?.message || `${record.buyer} (${record.ref}) has reached ${stage.full}.` };
      }));
    }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [path, record.status, record.agent_id, record.buyer, record.ref]);
  function change(index: number, value: Partial<Rule>) {
    setRules(old => old.map((r, i) => i === index ? { ...r, ...value } : r)); setSaved(false);
  }
  return <section className="stage-notifications" aria-label="Agent stage notifications">
    <h3>Notify agent on progress</h3>
    <p>Choose the stages that should send a WhatsApp update to <strong>{agentName || "the assigned agent"}</strong>. Muse writes the message from the text you approve below.</p>
    {data && <>
      {!data.enabled && <p className="stage-notice">Stage notifications are paused. The workspace owner can enable them in Settings → Muse agent.</p>}
      {!data.contact_ready && <p className="stage-notice">The assigned agent needs an approved WhatsApp number and messaging consent before updates can be queued.</p>}
      <form onSubmit={e => { e.preventDefault(); setBusy(true); setError(""); setSaved(false);
        void send(path, { rules }, "PUT").then(async () => { setData(await api<Result>(path)); setSaved(true); })
          .catch(e => setError(errorMessage(e))).finally(() => setBusy(false));
      }}>
        <fieldset disabled={busy}>
          <legend className="sr-only">Stages to share with the assigned agent</legend>
          {rules.map((rule, i) => {
            const stage = stages[i], job = data.jobs.find(j => j.stage === rule.stage);
            return <div className="stage-rule" key={rule.stage}>
              <label className="stage-check"><input type="checkbox" checked={rule.enabled} onChange={e => change(i, { enabled: e.target.checked })}/><span>{stage.full}</span>
                {record.status === rule.stage && <small>Current stage</small>}</label>
              {rule.enabled && <label className="stage-message"><span>Message for the agent</span>
                <textarea aria-label={`${stage.full} message`} rows={2} maxLength={800} required value={rule.message} onChange={e => change(i, { message: e.target.value })}/></label>}
              {job && <p className="stage-job">{job.delivery_status || job.state}{job.review_reason ? ` · ${job.review_reason}` : ""}</p>}
            </div>;
          })}
        </fieldset>
        <p className="stage-footnote">Save these choices before changing the case stage. Each selected stage sends once when reached; enabling the current stage does not send an old update. Changing the stage or assigned agent cancels an unsent update. Internal notes stay private.</p>
        <div className="settings-actions"><Button disabled={busy}>{busy ? "Saving…" : "Save notification choices"}</Button>{saved && <span role="status">Choices saved.</span>}</div>
      </form>
    </>}
    {!data && !error && <p>Loading notification choices…</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>;
}
