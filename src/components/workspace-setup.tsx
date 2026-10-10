import { useState, type FormEvent } from "react";
import {
  FolderKanban,
  ArrowRight,
  LoaderCircle,
  HardDrive,
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
export function WorkspaceSetup({ onReady }: { onReady: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await localApi("setup", {
        name: data.get("name"),
        sample: data.get("sample") === "on",
      });
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
        <FolderKanban size={24} />
        CaseTrack <span>Local workspace</span>
      </a>
      <Card className="vault-card">
        <CardHeader>
          <div className="vault-icon">
            <FolderKanban size={24} />
          </div>
          <CardTitle>Name your workspace</CardTitle>
          <CardDescription>
            Give your workspace a name to get started. You can change it later
            in Settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="vault-form">
            <label>
              Workspace name
              <Input
                name="name"
                required
                maxLength={150}
                placeholder="Your firm or practice"
                autoComplete="organization"
                autoFocus
              />
            </label>
            <label className="sample-choice">
              <input name="sample" type="checkbox" />
              Include fictional sample cases
            </label>
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
              {busy ? "Creating…" : "Create workspace"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="vault-footnote">
        <HardDrive size={15} />
        Stored on this computer · No sign-in required
      </p>
    </main>
  );
}
