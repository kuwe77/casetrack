import { useState, type FormEvent } from "react";
import { client } from "../lib/supabase";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { errorMessage } from "../lib/repository";
export function AccountSecurity() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
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
      const { error } = await client().auth.updateUser({ password });
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
      <p>Change the password supplied by your administrator.</p>
      <form onSubmit={submit} className="vault-form">
        <label>
          New password
          <Input
            type="password"
            autoComplete="new-password"
            name="password"
            minLength={12}
            maxLength={1024}
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
            maxLength={1024}
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
    </section>
  );
}
