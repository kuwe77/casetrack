import { useEffect, useState, type FormEvent } from "react";
import { Buildings, Check, Plus, ArrowLeft, LinkSimple } from "@phosphor-icons/react";
import { api, send, openWorkspace, type WorkspaceMembership } from "../lib/api";
import { errorMessage } from "../lib/repository";
import { Modal } from "./ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import "./workspace-switcher.css";

export function WorkspaceSwitcher({ currentId, onClose, initialJoin = false }: { currentId: string | null; onClose: () => void; initialJoin?: boolean }) {
  const [mode, setMode] = useState<"list" | "create" | "join">(initialJoin ? "join" : "list");
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [name, setName] = useState(""), [invitation, setInvitation] = useState(sessionStorage.getItem("casetrack-invitation") || "");
  useEffect(() => { let active = true;
    void api<WorkspaceMembership[]>("/workspaces").then(rows => { if (active) setWorkspaces(rows); })
      .catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  function chooseMode(next: typeof mode) { setMode(next); setError(""); }
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const result = mode === "create"
        ? await send<{ id: string }>("/workspace", { name: name.trim() })
        : await send<{ id: string }>("/invitations/accept", { token: invitation.trim().split("#").at(-1) });
      if (mode === "join") sessionStorage.removeItem("casetrack-invitation");
      openWorkspace(result.id);
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  }
  return <Modal open onClose={() => { if (!busy) { sessionStorage.removeItem("casetrack-invitation"); onClose(); } }}
    title={mode === "create" ? "Create a workspace" : mode === "join" ? "Join a workspace" : "Your workspaces"}
    description={mode === "list" ? "Each workspace has its own cases, agents, team and settings. Save your changes before switching." : mode === "create" ? "Start with an empty workspace for another team or office." : "Use an invitation sent to your account’s email address."}>
    <div className="workspace-picker">
      {mode === "list" ? <>
        {loading ? <p role="status">Loading workspaces…</p> : <div className="workspace-picker-list" aria-label="Your workspaces">{workspaces.map(w => <button key={w.id} className="workspace-picker-item" aria-label={`Open workspace: ${w.name}`} aria-current={w.id === currentId ? "true" : undefined} onClick={() => w.id === currentId ? onClose() : openWorkspace(w.id)}>
          <span className="workspace-picker-icon"><Buildings size={21}/></span><span className="workspace-picker-name"><strong>{w.name}</strong><small>{w.role === "owner" ? "Owner" : "Member"}{w.id === currentId ? " · Current workspace" : ""}</small></span>{w.id === currentId && <Check size={19} aria-label="Current workspace"/>}
        </button>)}</div>}
        <div className="workspace-picker-actions"><Button onClick={() => chooseMode("create")}><Plus size={17}/>Create workspace</Button><Button variant="outline" onClick={() => chooseMode("join")}><LinkSimple size={17}/>Join workspace</Button></div>
      </> : <form onSubmit={submit} className="workspace-picker-form">
        <Button type="button" variant="ghost" className="workspace-picker-back" disabled={busy} onClick={() => chooseMode("list")}><ArrowLeft size={16}/>All workspaces</Button>
        {mode === "create" ? <><label htmlFor="workspace-name">Workspace name</label><Input id="workspace-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kuala Lumpur office" required maxLength={150} autoFocus/><p className="workspace-picker-help">Add your team and records after creating it. Set up WhatsApp and API access separately in this workspace.</p></> : <><label htmlFor="workspace-invitation">Invitation link or token</label><Input id="workspace-invitation" value={invitation} onChange={e => setInvitation(e.target.value)} required autoFocus autoComplete="off"/><p className="workspace-picker-help">You can belong to several workspaces using the same account.</p></>}
        <Button type="submit" disabled={busy || (mode === "create" ? !name.trim() : !invitation.trim())}>{busy ? "Opening workspace…" : mode === "create" ? "Create workspace" : "Accept invitation"}</Button>
      </form>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </Modal>;
}
