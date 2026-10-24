import { useState, type ReactNode, type FormEvent } from "react";
import { FolderKanban, LoaderCircle, LogOut } from "lucide-react";
import { authClient } from "../lib/auth-client";
import { errorMessage } from "../lib/repository";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./ui/card";
import { Landing } from "./landing";

export function SignOut() {
  const [error, setError] = useState("");
  return <><Button variant="ghost" title="Sign out" aria-label="Sign out" onClick={async () => {
    const result = await authClient.signOut();
    if (result.error) setError(result.error.message || "Could not sign out."); else window.location.assign("/");
  }}><LogOut size={17} /></Button>{error && <span role="alert">{error}</span>}</>;
}
export function AuthGate({ children }: { children: ReactNode }) {
  if (location.pathname === "/" || location.pathname === "/privacy") {
    return <Landing signedIn={false} privacy={location.pathname === "/privacy"}/>;
  }
  return <PrivateGate>{children}</PrivateGate>;
}
function PrivateGate({ children }: { children: ReactNode }) {
  const { data: session, isPending, error, refetch } = authClient.useSession();
  const path = location.pathname;
  if (path === "/join" && /^[a-f0-9]{64}$/.test(location.hash.slice(1))) {
    sessionStorage.setItem("casetrack-invitation", location.hash.slice(1));
    history.replaceState(null, "", "/join");
  }
  if (isPending) return <main className="center-state"><LoaderCircle className="animate-spin" /><p>Checking your session…</p></main>;
  if (error) return <main className="center-state"><h1>Could not connect</h1><p>{error.message}</p><Button onClick={() => void refetch()}>Try again</Button></main>;
  if (!session) return <AccountForm />;
  return <div key={session.user.id}>{children}</div>;
}
function AccountForm() {
  const [mode, setMode] = useState(location.pathname === "/register" || location.pathname === "/join" ? "register" : "login");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    const data = new FormData(e.currentTarget), email = String(data.get("email")).trim(), password = String(data.get("password"));
    try {
      if (mode === "recover") {
        const response = await fetch("/api/account/recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, recoveryCode: String(data.get("recoveryCode")).trim() }) });
        const result = await response.json(); if (!response.ok) throw Error(result.error);
        setNotice("Password reset. Sign in with your new password, then generate a new recovery code.");
        setMode("login"); return;
      }
      const result = mode === "register"
        ? await authClient.signUp.email({ email, password, name: String(data.get("name")).trim() })
        : await authClient.signIn.email({ email, password });
      if (result.error) throw Error(result.error.message);
      location.assign("/app");
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <main className="vault-screen">
    <a className="vault-brand" href="/"><FolderKanban />JuriSync</a>
    <Card className="vault-card"><CardHeader>
      <CardTitle>{mode === "register" ? "Start your firm’s workspace" : mode === "recover" ? "Recover your account" : "Welcome back"}</CardTitle>
      <CardDescription>{mode === "register" ? "Create your account, then create a firm or join an invitation." : mode === "recover" ? "Use your saved recovery code to set a new password." : "Sign in to continue your matters."}</CardDescription>
    </CardHeader><CardContent>
      <form className="vault-form" onSubmit={submit}>
        {mode === "register" && <label>Your name<Input name="name" required maxLength={150} autoComplete="name" /></label>}
        <label>Email address<Input name="email" type="email" required autoComplete="username" maxLength={254} /></label>
        {mode === "recover" && <label>Recovery code<Input name="recoveryCode" required autoComplete="off" /></label>}
        <label>{mode === "recover" ? "New password" : "Password"}<Input name="password" type="password" required minLength={12} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
        {mode !== "login" && <p className="vault-help">Use at least 12 characters. Save a recovery code in Settings after signing up.</p>}
        {error && <p role="alert" className="form-error">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <Button disabled={busy}>{busy ? "Please wait…" : mode === "register" ? "Create account" : mode === "recover" ? "Reset password" : "Sign in"}</Button>
      </form>
      <div className="auth-links">
        <Button variant="link" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "New here? Create an account" : "Already registered? Sign in"}</Button>
        {mode === "login" && <Button variant="link" onClick={() => setMode("recover")}>Use a recovery code</Button>}
      </div>
      <p className="vault-help">Read how JuriSync handles your data in our <a href="/privacy">privacy information</a>.</p>
    </CardContent></Card>
  </main>;
}
