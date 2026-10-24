import { useState, type FormEvent } from "react";
import { FolderKanban } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { send } from "../lib/api";
import { errorMessage } from "../lib/repository";
import { SignOut } from "./auth-gate";
export function WorkspaceSetup({ onReady }: { onReady: (id: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [invite, setInvite] = useState(sessionStorage.getItem("casetrack-invitation") || "");
  async function submit(e: FormEvent<HTMLFormElement>, join: boolean) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const result = join
        ? await send<{ id: string }>("/invitations/accept", { token: invite.includes("#") ? invite.split("#").at(-1)?.trim() : invite.trim() })
        : await send<{ id: string }>("/workspace", { name: String(new FormData(e.currentTarget).get("name")).trim() });
      if (join) sessionStorage.removeItem("casetrack-invitation");
      onReady(result.id);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <main className="vault-screen"><a className="vault-brand" href="/"><FolderKanban/>JuriSync</a><Card className="vault-card">
    <CardHeader><CardTitle>{invite ? "Join your firm" : "Name your workspace"}</CardTitle><CardDescription>Create a private workspace for your firm or use a colleague’s invitation.</CardDescription></CardHeader>
    <CardContent>
      <form className="vault-form" onSubmit={e => void submit(e, false)}><label>Firm name<Input name="name" required maxLength={150} autoComplete="organization" placeholder="Your firm or practice"/></label><Button disabled={busy}>Create workspace</Button></form>
      <hr className="my-6"/><form className="vault-form" onSubmit={e => void submit(e, true)}><label>Invitation link or token<Input value={invite} onChange={e => setInvite(e.target.value)} required autoComplete="off"/></label><Button variant="outline" disabled={busy}>Join workspace</Button><p className="vault-help">Sign in using the email address your colleague invited.</p></form>
      {error && <p className="form-error" role="alert">{error}</p>}
    </CardContent></Card><SignOut/></main>;
}
