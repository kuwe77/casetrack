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
    <section className="settings-export">
      <h3>Your account password</h3>
      <p>Update your password or create a recovery code. Keep the recovery code in your password manager.</p>
      <form onSubmit={submit} className="vault-form">
        <label>Current password<Input type="password" name="currentPassword" autoComplete="current-password" required maxLength={128}/></label>
        <label>
          New password
          <Input
            type="password"
            autoComplete="new-password"
            name="password"
            minLength={12}
            maxLength={128}
            required
          />
        </label>
        <label>
          Confirm password
          <Input
            type="password"
            autoComplete="new-password"
            name="confirm"
            minLength={12}
            maxLength={128}
            required
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <Button disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </Button>
      </form>
      <form className="vault-form mt-6" onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError(""); setRecovery("");
        try {
          const result = await send<{ code: string }>("/account/recovery-code", { password: String(new FormData(e.currentTarget).get("password")) });
          setRecovery(result.code);
        } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
      }}><label>Confirm password for recovery code<Input name="password" type="password" autoComplete="current-password" required maxLength={128}/></label><Button variant="outline" disabled={busy}>Generate new recovery code</Button></form>
      {recovery && <div className="wa-token"><p>Save this now. Replaces any previous code and can be used once.</p><code className="break-all select-all">{recovery}</code><Button variant="ghost" onClick={() => setRecovery("")}>I saved it</Button></div>}
    </section>
  );
}
