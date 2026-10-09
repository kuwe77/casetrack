import { useState, type FormEvent } from "react";
import {
  LockKeyhole,
  ShieldCheck,
  FolderKanban,
  ArrowRight,
  LoaderCircle,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Input } from "./ui/input";
import { localApi, errorMessage } from "../lib/repository";
export function Unlock({
  initialized,
  onReady,
}: {
  initialized: boolean;
  onReady: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    const password = String(data.get("password"));
    if (!initialized && password !== data.get("confirm")) {
      setError("The passphrases do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await localApi(
        initialized ? "unlock" : "setup",
        initialized
          ? { password }
          : {
              password,
              name: data.get("name"),
              sample: data.get("sample") === "on",
            },
      );
      form.reset();
      onReady();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="vault-screen">
      <a className="vault-brand" href="#">
        <FolderKanban size={24} /> CaseTrack <span>Local workspace</span>
      </a>
      <Card className="vault-card">
        <CardHeader>
          <div className="vault-icon">
            <LockKeyhole size={24} />
          </div>
          <CardTitle>
            {initialized
              ? "Unlock your workspace"
              : "Create your private workspace"}
          </CardTitle>
          <CardDescription>
            {initialized
              ? "Enter your passphrase to access the records on this computer."
              : "Your cases stay on this computer, encrypted with a passphrase you choose."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="vault-form">
            {!initialized && (
              <label>
                Workspace name
                <Input
                  name="name"
                  required
                  maxLength={150}
                  placeholder="Your firm or practice"
                  autoComplete="organization"
                />
              </label>
            )}
            <label>
              Passphrase
              <Input
                name="password"
                type="password"
                required
                minLength={14}
                maxLength={1024}
                autoComplete={initialized ? "current-password" : "new-password"}
                autoFocus={initialized}
                placeholder={
                  initialized
                    ? "Enter your passphrase"
                    : "At least 14 characters"
                }
              />
            </label>
            {!initialized && (
              <>
                <label>
                  Confirm passphrase
                  <Input
                    name="confirm"
                    type="password"
                    required
                    minLength={14}
                    maxLength={1024}
                    autoComplete="new-password"
                  />
                </label>
                <p className="vault-help">
                  Use a long, unique passphrase and keep it in your password
                  manager. There is no password reset or recovery key.
                </p>
                <label className="sample-choice">
                  <input name="sample" type="checkbox" /> Include fictional
                  sample cases
                </label>
              </>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <ArrowRight />
              )}
              {busy
                ? "Opening…"
                : initialized
                  ? "Unlock workspace"
                  : "Create encrypted workspace"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="vault-footnote">
        <ShieldCheck size={15} /> Encrypted at rest · Local access only · No
        cloud account
      </p>
    </main>
  );
}
