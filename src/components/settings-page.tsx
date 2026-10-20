import { useState, type FormEvent } from "react";
import { Tabs } from "radix-ui";
import { Export } from "@phosphor-icons/react";
import type { Workspace } from "../lib/model";
import { downloadCsv } from "../lib/model";
import { errorMessage } from "../lib/repository";
import { AccountSecurity } from "./account-security";
import { ApiAccess } from "./api-access";
import { WorkspaceTeam } from "./workspace-team";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import "./settings.css";

const sections = [
  ["profile", "Profile"],
  ["members", "Members"],
  ["api", "API access"],
  ["security", "Security"],
  ["data", "Data & exports"],
] as const;

export function SettingsPage({ w, onSave }: {
  w: Workspace;
  onSave: (firm: Workspace["firm"]) => Promise<void>;
}) {
  const [section, setSection] = useState("profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(""); setSaved(false);
    const data = new FormData(e.currentTarget);
    try {
      const name = String(data.get("name") || "").trim();
      if (!name) throw Error("Enter a workspace name.");
      await onSave({ ...w.firm, name, email: String(data.get("email") || "").trim() });
      setSaved(true);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return (
    <div className="settings-page">
      <div className="page-heading">
        <div><h1>Workspace settings</h1><p>Manage your firm, team and connected tools.</p></div>
      </div>
      <Tabs.Root value={section} onValueChange={setSection}>
        <Tabs.List className="settings-tabs" aria-label="Settings sections">
          {sections.map(([value, label]) => <Tabs.Trigger key={value} value={value} className="settings-tab">{label}</Tabs.Trigger>)}
        </Tabs.List>
        {/* Keep unfinished forms and one-time secrets intact when switching sections. */}
        <Tabs.Content value="profile" forceMount hidden={section !== "profile"} className="settings-section">
          <header className="settings-section-header"><h2>Firm profile</h2><p>The contact details shown throughout your workspace.</p></header>
          <form className="settings-form settings-form-narrow" onSubmit={submit} onChange={() => setSaved(false)}>
            <label className="settings-field"><span>Firm name</span><Input name="name" defaultValue={w.firm.name} required maxLength={150}/></label>
            <label className="settings-field"><span>Office email</span><Input type="email" name="email" defaultValue={w.firm.email} maxLength={254}/></label>
            <dl className="settings-facts">
              <div><dt>Timezone</dt><dd>Asia / Kuala Lumpur</dd></div>
              <div><dt>Currency</dt><dd>MYR · Malaysian ringgit</dd></div>
            </dl>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="settings-actions"><Button disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>{saved && <span role="status">Changes saved.</span>}</div>
          </form>
        </Tabs.Content>
        <Tabs.Content value="members" forceMount hidden={section !== "members"} className="settings-section"><WorkspaceTeam/></Tabs.Content>
        <Tabs.Content value="api" forceMount hidden={section !== "api"} className="settings-section"><ApiAccess/></Tabs.Content>
        <Tabs.Content value="security" forceMount hidden={section !== "security"} className="settings-section"><AccountSecurity/></Tabs.Content>
        <Tabs.Content value="data" forceMount hidden={section !== "data"} className="settings-section">
          <header className="settings-section-header"><h2>Data & exports</h2><p>Download your records and review your data options.</p></header>
          <section className="settings-data-section">
            <h3>Export your cases</h3><p>Download a spreadsheet-compatible CSV of all cases. Exported files are unencrypted; store them carefully.</p>
            <Button variant="outline" onClick={() => downloadCsv(w.cases, w.agents)}><Export size={17}/>Export all cases</Button>
          </section>
          <section className="settings-data-section">
            <h3>Who can access your data</h3><p>Your workspace is private to your firm. Members can access its records, and connected tools can only use the permissions you grant.</p>
          </section>
          <section className="settings-data-section">
            <h3>Backups and recovery</h3><p>Contact your administrator about backups or restoring records. CSV exports include case data and are not a complete workspace backup.</p>
          </section>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
