import { useEffect, useState, type FormEvent } from "react";
import { MessageCircle, ShieldCheck, RefreshCw, KeyRound } from "lucide-react";
import { client } from "../lib/supabase";
import { rpc, errorMessage } from "../lib/repository";
import type { Workspace } from "../lib/model";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
type Settings = {
  account_id: string;
  enabled: boolean;
  dry_run: boolean;
  auto_reply: boolean;
  poll_seconds: number;
  last_poll_at?: string;
  worker_status?: string;
};
type Contact = {
  agent_id: string;
  phone: string;
  enabled: boolean;
  consent: boolean;
};
type Rule = {
  case_id: string;
  enabled: boolean;
  mode: string;
  interval_hours: number;
  next_due_at: string;
  shared_update: string;
  template_name: string;
  template_language: string;
};
type Event = {
  id: string;
  phone: string;
  kind: string;
  status: string;
  reason: string;
  response: string;
  created_at: string;
};
const initial: Settings = {
  account_id: "",
  enabled: false,
  dry_run: true,
  auto_reply: true,
  poll_seconds: 60,
};
export function WhatsAppPage({ w }: { w: Workspace }) {
  const [settings, setSettings] = useState(initial),
    [contacts, setContacts] = useState<Contact[]>([]),
    [rules, setRules] = useState<Rule[]>([]),
    [events, setEvents] = useState<Event[]>([]);
  const [owner, setOwner] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [token, setToken] = useState("");
  async function refresh() {
    const {
      data: { user },
    } = await client().auth.getUser();
    const members = await client()
      .from("workspace_members")
      .select("user_id,role");
    if (members.error) throw members.error;
    const allowed = members.data.some(
      (m) => m.user_id === user?.id && m.role === "owner",
    );
    setOwner(allowed);
    if (!allowed) return;
    const [s, c, r, e] = await Promise.all([
      client().from("whatsapp_settings").select("*").maybeSingle(),
      client()
        .from("whatsapp_contacts")
        .select("agent_id,phone,enabled,consent"),
      client().from("whatsapp_rules").select("*"),
      client()
        .from("whatsapp_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    for (const result of [s, c, r, e]) if (result.error) throw result.error;
    setSettings(s.data || initial);
    setContacts(c.data || []);
    setRules(r.data || []);
    setEvents(e.data || []);
  }
  useEffect(() => {
    void refresh()
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);
  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
      setNotice(message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(table: string, value: object) {
    const { error } = await client()
      .from(table)
      .upsert({ firm_id: w.firm.id, ...value });
    if (error) throw error;
  }
  if (loading) return <p>Loading WhatsApp settings…</p>;
  if (!owner)
    return (
      <Card className="wa-card">
        <ShieldCheck size={22} />
        <h2>Owner access required</h2>
        <p>Your workspace owner manages WhatsApp access and follow-ups.</p>
      </Card>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Agent communication</span>
          <h1>WhatsApp</h1>
          <p>Case updates, connected to the right people.</p>
        </div>
        <Button
          className="wa-refresh"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void act(async () => {}, "Connection status refreshed")
          }
        >
          <RefreshCw size={15} />
          Refresh
        </Button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="wa-notice" role="status">
          {notice}
        </p>
      )}
      <div className="wa-layout">
        <Card className="wa-card">
          <div className="wa-title">
            <MessageCircle size={19} />
            <h2>Connection & replies</h2>
            <span className="wa-state">
              {settings.enabled
                ? settings.dry_run
                  ? "Preview mode"
                  : "Live"
                : "Paused"}
            </span>
          </div>
          <p>
            Only verified numbers can request their assigned cases. Replies use
            the latest recorded stage, target date and approved shared update.
          </p>
          <form
            className="wa-form"
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                () => rpc("configure_whatsapp", { settings }),
                "WhatsApp settings saved",
              );
            }}
          >
            <label className="field">
              <span>Zernio WhatsApp account ID</span>
              <Input
                required
                value={settings.account_id}
                onChange={(e) =>
                  setSettings({ ...settings, account_id: e.target.value })
                }
                placeholder="From zernio accounts:list"
                maxLength={100}
              />
            </label>
            <label className="wa-check">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) =>
                  setSettings({ ...settings, enabled: e.target.checked })
                }
              />
              Enable polling and configured follow-ups
            </label>
            <label className="wa-check">
              <input
                type="checkbox"
                checked={settings.dry_run}
                onChange={(e) =>
                  setSettings({ ...settings, dry_run: e.target.checked })
                }
              />
              Preview only — log replies without sending
            </label>
            <label className="wa-check">
              <input
                type="checkbox"
                checked={settings.auto_reply}
                onChange={(e) =>
                  setSettings({ ...settings, auto_reply: e.target.checked })
                }
              />
              Answer incoming case-progress inquiries
            </label>
            <label className="field">
              <span>Poll interval (seconds)</span>
              <Input
                type="number"
                required
                min={30}
                max={600}
                value={settings.poll_seconds}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    poll_seconds: Number(e.target.value),
                  })
                }
              />
            </label>
            <Button disabled={busy}>Save connection</Button>
          </form>
          <small className="wa-muted">
            Worker: {settings.worker_status || "Not connected"} · Last poll:{" "}
            {settings.last_poll_at
              ? new Date(settings.last_poll_at).toLocaleString()
              : "Never"}
          </small>
        </Card>
        <Card className="wa-card">
          <div className="wa-title">
            <KeyRound size={19} />
            <h2>Connect your worker</h2>
          </div>
          <p>
            Run the polling worker on an always-on computer with Zernio CLI and
            Hermes installed. Your Zernio key stays on that computer.
          </p>
          <ol className="wa-steps">
            <li>
              Install Zernio CLI and sign in to the account with WhatsApp
              connected.
            </li>
            <li>Generate a workspace worker token below.</li>
            <li>
              Add the token and account ID to the worker’s private
              configuration, then start it.
            </li>
          </ol>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (
                token &&
                !window.confirm(
                  "Replace this token? The previous worker token will stop working.",
                )
              )
                return;
              void act(async () => {
                const bytes = crypto.getRandomValues(new Uint8Array(32));
                const value = Array.from(bytes, (b) =>
                  b.toString(16).padStart(2, "0"),
                ).join("");
                await rpc("rotate_whatsapp_worker", { worker_token: value });
                setToken(value);
              }, "Worker token generated. Save it privately; it is shown only here. Previous tokens are revoked.");
            }}
          >
            Generate / replace worker token
          </Button>
          {token && (
            <div className="wa-token">
              <label className="field">
                <span>Worker token — keep private</span>
                <Input
                  readOnly
                  type="password"
                  value={token}
                  autoComplete="off"
                />
              </label>
              <Button
                variant="outline"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(token)
                    .then(() => setNotice("Worker token copied"))
                    .catch(() => setError("Could not copy token"))
                }
              >
                Copy token
              </Button>
              <Button variant="ghost" onClick={() => setToken("")}>
                Dismiss
              </Button>
            </div>
          )}
          <a
            className="text-link"
            href="https://github.com/kuwe77/casetrack/blob/main/WHATSAPP.md"
            target="_blank"
            rel="noreferrer"
          >
            Worker setup guide ↗
          </a>
          <div className="wa-policy">
            <ShieldCheck size={18} />
            <p>
              Internal notes, buyer/seller details and financial values are
              excluded. Unknown numbers and other agents’ cases are blocked.
              STOP disables the number.
            </p>
          </div>
        </Card>
      </div>
      <Card className="wa-card">
        <h2>Verified agent numbers</h2>
        <p>
          Verify ownership of each number yourself. Enter the same international
          number in Agents, then approve it here. Consent is required for
          scheduled follow-ups.
        </p>
        {!w.agents.length && (
          <p className="wa-muted">Add an agent in the Agents tab first.</p>
        )}
        {w.agents.map((a) => (
          <ContactEditor
            key={`${a.id}:${JSON.stringify(contacts.find((c) => c.agent_id === a.id))}`}
            name={a.name}
            phone={a.phone}
            value={
              contacts.find((c) => c.agent_id === a.id) || {
                agent_id: a.id,
                phone: a.phone,
                enabled: false,
                consent: false,
              }
            }
            busy={busy}
            onSave={(v) =>
              act(() => save("whatsapp_contacts", v), "Agent access saved")
            }
          />
        ))}
      </Card>
      <Card className="wa-card">
        <h2>Case follow-up rules</h2>
        <p>
          Choose a cadence and what each agent receives. Completed and on-hold
          cases are skipped. Replies never change case progress automatically.
        </p>
        {!w.cases.length && (
          <p className="wa-muted">
            Create a case and assign its property agent to configure follow-ups.
          </p>
        )}
        {w.cases.map((c) => (
          <RuleEditor
            key={`${c.id}:${JSON.stringify(rules.find((r) => r.case_id === c.id))}`}
            label={`${c.ref} · ${w.agents.find((a) => a.id === c.agent_id)?.name || "No agent assigned"}`}
            value={
              rules.find((r) => r.case_id === c.id) || {
                case_id: c.id,
                enabled: false,
                mode: "request_update",
                interval_hours: 72,
                next_due_at: new Date().toISOString(),
                shared_update: "",
                template_name: "",
                template_language: "en_US",
              }
            }
            busy={busy}
            onSave={(v) =>
              act(() => save("whatsapp_rules", v), "Case rule saved")
            }
          />
        ))}
      </Card>
      <Card className="wa-card">
        <h2>Recent activity</h2>
        <p>
          Preview, blocked and attempted messages. “Sent” means Zernio accepted
          the request; it does not confirm delivery. Uncertain sends require a
          manual check before resending.
        </p>
        {!events.length ? (
          <p className="wa-muted">
            No messages processed yet. Enable preview mode and connect the
            worker to begin.
          </p>
        ) : (
          <div className="wa-events">
            {events.map((e) => (
              <article key={e.id}>
                <div className="wa-event-head">
                  <strong>
                    {e.kind === "reply" ? "Inquiry" : "Follow-up"} · {e.phone}
                  </strong>
                  <span className="wa-state">{e.status}</span>
                </div>
                <small>
                  {new Date(e.created_at).toLocaleString()} · {e.reason}
                </small>
                {e.response && <p className="wa-response">{e.response}</p>}
              </article>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
function ContactEditor({
  name,
  phone,
  value,
  busy,
  onSave,
}: {
  name: string;
  phone: string;
  value: Contact;
  busy: boolean;
  onSave: (v: Contact) => Promise<void>;
}) {
  const [v, set] = useState(value);
  return (
    <form
      className="wa-contact"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(v);
      }}
    >
      <div>
        <strong>{name}</strong>
        <small>On file: {phone || "No number"}</small>
      </div>
      <label className="field">
        <span>Verified international number</span>
        <Input
          aria-label={`Verified number for ${name}`}
          required
          pattern="\+[1-9][0-9]{7,14}"
          placeholder="+60123456789"
          value={v.phone}
          onChange={(e) => set({ ...v, phone: e.target.value })}
        />
      </label>
      <label className="wa-check">
        <input
          type="checkbox"
          checked={v.enabled}
          onChange={(e) => set({ ...v, enabled: e.target.checked })}
        />
        Identity verified
      </label>
      <label className="wa-check">
        <input
          type="checkbox"
          checked={v.consent}
          onChange={(e) => set({ ...v, consent: e.target.checked })}
        />
        Follow-up consent
      </label>
      <Button variant="outline" disabled={busy}>
        Save access
      </Button>
    </form>
  );
}
function RuleEditor({
  label,
  value,
  busy,
  onSave,
}: {
  label: string;
  value: Rule;
  busy: boolean;
  onSave: (v: Rule) => Promise<void>;
}) {
  const [v, set] = useState(value);
  function submit(e: FormEvent) {
    e.preventDefault();
    void onSave(v);
  }
  return (
    <details className="wa-rule">
      <summary>
        {label}
        <span>{v.enabled ? "Scheduled" : "Off"}</span>
      </summary>
      <form className="wa-form" onSubmit={submit}>
        <label className="wa-check">
          <input
            type="checkbox"
            checked={v.enabled}
            onChange={(e) => set({ ...v, enabled: e.target.checked })}
          />
          Enable scheduled follow-ups
        </label>
        <div className="wa-fields">
          <label className="field">
            <span>Follow-up type</span>
            <select
              value={v.mode}
              onChange={(e) => set({ ...v, mode: e.target.value })}
            >
              <option value="request_update">Ask agent for an update</option>
              <option value="send_progress">Send our latest progress</option>
            </select>
          </label>
          <label className="field">
            <span>Repeat every (hours)</span>
            <Input
              type="number"
              required
              min={24}
              max={2160}
              value={v.interval_hours}
              onChange={(e) =>
                set({ ...v, interval_hours: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>Next follow-up</span>
            <Input
              type="datetime-local"
              required
              value={new Date(
                new Date(v.next_due_at).getTime() -
                  new Date(v.next_due_at).getTimezoneOffset() * 60000,
              )
                .toISOString()
                .slice(0, 16)}
              onChange={(e) => {
                if (e.target.value)
                  set({
                    ...v,
                    next_due_at: new Date(e.target.value).toISOString(),
                  });
              }}
            />
          </label>
        </div>
        <label className="field">
          <span>Approved update visible to this case’s agent</span>
          <Textarea
            rows={2}
            maxLength={1000}
            value={v.shared_update}
            onChange={(e) => set({ ...v, shared_update: e.target.value })}
            placeholder="Optional update approved for sharing externally"
          />
        </label>
        <div className="wa-fields">
          <label className="field">
            <span>Approved WhatsApp template name</span>
            <Input
              value={v.template_name}
              pattern="[a-z0-9_]*"
              maxLength={100}
              onChange={(e) => set({ ...v, template_name: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Template language</span>
            <Input
              required
              value={v.template_language}
              pattern="[a-z]{2,3}(_[A-Z]{2})?"
              onChange={(e) => set({ ...v, template_language: e.target.value })}
            />
          </label>
        </div>
        <small className="wa-muted">
          For closed reply windows, use an approved text-only template with
          exactly one body variable: the case update. No template means the
          follow-up is blocked.
        </small>
        <Button disabled={busy}>Save case rule</Button>
      </form>
    </details>
  );
}
