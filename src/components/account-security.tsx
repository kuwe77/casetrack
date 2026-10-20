import { useState, type FormEvent } from "react";
import { authClient } from "../lib/auth-client";
import { send } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { errorMessage } from "../lib/repository";
export function AccountSecurity() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [recovery, setRecovery] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    setError("");
    setMessage("");
    const password = String(data.get("password"));
    if (password !== data.get("confirm")) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await authClient.changePassword({ newPassword: password, currentPassword: String(data.get("currentPassword")), revokeOtherSessions: true });
      if (error) throw error;
      form.reset();
      setMessage("Password updated.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-security">
      <header className="settings-section-header"><h2>Account security</h2><p>Manage your password and recovery code.</p></header>
      {error && <p className="form-error" role="alert">{error}</p>}
      <form onSubmit={submit} className="settings-form settings-form-narrow">
        <h3>Change password</h3>
        <label className="settings-field"><span>Current password</span><Input type="password" name="currentPassword" autoComplete="current-password" required maxLength={128}/></label>
        <label className="settings-field">
          <span>New password</span>
          <Input
            type="password"
            autoComplete="new-password"
            name="password"
            minLength={12}
            maxLength={128}
            required
          />
        </label>
        <label className="settings-field">
          <span>Confirm password</span>
          <Input
            type="password"
            autoComplete="new-password"
            name="confirm"
            minLength={12}
            maxLength={128}
            required
          />
        </label>
        <p className="settings-help">Use at least 12 characters. Updating your password signs out your other sessions.</p>
        {message && <p role="status">{message}</p>}
        <div className="settings-actions"><Button disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </Button></div>
      </form>
      <div className="settings-security-recovery">
      <h3>Account recovery</h3>
      <p className="settings-help">Keep a recovery code in your password manager so you can regain access if you forget your password.</p>
      <form className="settings-form settings-form-narrow" onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError(""); setRecovery("");
        try {
          const result = await send<{ code: string }>("/account/recovery-code", { password: String(new FormData(e.currentTarget).get("password")) });
          setRecovery(result.code);
        } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
      }}><label className="settings-field"><span>Confirm your current password</span><Input name="password" type="password" autoComplete="current-password" required maxLength={128}/></label><div className="settings-actions"><Button variant="outline" disabled={busy}>Generate new recovery code</Button></div></form>
      {recovery && <div className="settings-secret"><p>Save this now. Replaces any previous code and can be used once.</p><code>{recovery}</code><div className="settings-actions"><Button variant="ghost" onClick={() => setRecovery("")}>I saved it</Button></div></div>}
      </div>
    </section>
  );
}
