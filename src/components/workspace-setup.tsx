import { useEffect, useState, type FormEvent } from "react";
import { FolderKanban } from "lucide-react";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Input } from "./ui/input";
import { rpc, errorMessage } from "../lib/repository";
import { SignOut } from "./auth-gate";
interface Invitation {
  id: string;
  workspace_name: string;
  expires_at: string;
}
export function WorkspaceSetup({ onReady }: { onReady: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [invitations, setInvitations] = useState<Invitation[]>([]);
  async function refresh() {
    try {
      setInvitations(await rpc<Invitation[]>("pending_invitations"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await rpc("create_workspace", { workspace_name: form.get("name") });
      onReady();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function join(id: string) {
    setBusy(true);
    setError("");
    try {
      await rpc("accept_invitation", { invitation_id: id });
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
        <FolderKanban />
        CaseTrack <span>Workspace setup</span>
      </a>
      <Card className="vault-card">
        <CardHeader>
          <CardTitle>
            {invitations.length
              ? "Your workspace invitations"
              : "Name your workspace"}
          </CardTitle>
          <CardDescription>
            Join your firm’s invitation, or create a new workspace. Each account
            belongs to one workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invitations.map((i) => (
            <div className="invitation-row" key={i.id}>
              <strong>{i.workspace_name}</strong>
              <Button disabled={busy} onClick={() => join(i.id)}>
                Join workspace
              </Button>
            </div>
          ))}
          <form onSubmit={create} className="vault-form">
            <label>
              New workspace name
              <Input
                name="name"
                required
                maxLength={150}
                placeholder="Your firm or practice"
                autoComplete="organization"
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button disabled={busy}>
              {busy ? "Please wait…" : "Create workspace"}
            </Button>
          </form>
          <p className="vault-help">
            Expecting an invitation? Ask your workspace owner to invite this
            email before creating a new workspace.
          </p>
          <Button variant="ghost" disabled={busy} onClick={refresh}>
            Refresh invitations
          </Button>
        </CardContent>
      </Card>
      <SignOut />
    </main>
  );
}
