import { useEffect, useState, type FormEvent } from "react";
import { api, send } from "../lib/api";
import { errorMessage } from "../lib/repository";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
interface Member {
  user_id: string;
  email: string;
  role: string;
}
interface Invite {
  id: string;
  email: string;
  expires_at: string;
}
export function WorkspaceTeam() {
  const [members, setMembers] = useState<Member[]>([]),
    [invites, setInvites] = useState<Invite[]>([]),
    [owner, setOwner] = useState(false),
    [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function refresh() {
    const result = await api<{ members: Member[]; invites: Invite[]; owner: boolean }>("/team");
    setMembers(result.members); setInvites(result.invites); setOwner(result.owner);
  }
  useEffect(() => {
    void refresh().catch((e) => setError(errorMessage(e)));
  }, []);
  async function action(name: string, args: Record<string, string>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (name === "invite_member") {
        const result = await send<{ url: string }>("/invitations", { email: args.invitee_email });
        setMessage(result.url);
      } else await api(name === "remove_member" ? `/team/${args.member_id}` : `/invitations/${args.invitation_id}`, { method: "DELETE" });
      await refresh();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function invite(e: FormEvent) {
    e.preventDefault();
    if (await action("invite_member", { invitee_email: email })) {
      setEmail("");
    }
  }
  return (
    <section className="workspace-team">
      <h3>Workspace members</h3>
      <p>
        Members can view and edit cases, contacts, notes and follow-ups. Only
        the owner manages membership and firm details.
      </p>
      {members.map((m) => (
        <div className="team-row" key={m.user_id}>
          <span>
            {m.email}
            <small>{m.role}</small>
          </span>
          {owner && m.role === "member" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Remove ${m.email} from this workspace?`))
                  void action("remove_member", { member_id: m.user_id });
              }}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {owner && (
        <>
          <form onSubmit={invite} className="team-invite">
            <label className="field">
              <span>Invite by email</span>
              <Input
                required
                type="email"
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@firm.com"
              />
            </label>
            <Button disabled={busy}>Invite member</Button>
          </form>
          <p className="vault-help">
            Share the private invitation link with your colleague. They can register
            themselves with the invited email. Links expire after 7 days.
          </p>
          {invites.map((i) => (
            <div className="team-row" key={i.id}>
              <span>
                {i.email}
                <small>
                  {new Date(i.expires_at) < new Date() ? "Expired" : "Pending"}{" "}
                  · {new Date(i.expires_at).toLocaleDateString()}
                </small>
              </span>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void action("revoke_invitation", { invitation_id: i.id })
                }
              >
                Revoke
              </Button>
            </div>
          ))}
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="vault-help">
          Invitation link (shown once): <a href={message}>{message}</a>
        </p>
      )}
    </section>
  );
}
