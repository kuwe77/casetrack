import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { FolderKanban, LoaderCircle, LogOut } from "lucide-react";
import { supabase, configurationError, client } from "../lib/supabase";
import { errorMessage } from "../lib/repository";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
export function SignOut() {
  const [error, setError] = useState("");
  return (
    <>
      <Button
        variant="ghost"
        title="Sign out"
        aria-label="Sign out"
        onClick={async () => {
          const { error } = await client().auth.signOut();
          if (error) setError(error.message);
        }}
      >
        <LogOut size={17} />
      </Button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) {
        setSession(next);
        setLoading(false);
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  if (configurationError)
    return (
      <main className="vault-screen">
        <Card className="vault-card">
          <CardHeader>
            <CardTitle>Connect your Supabase project</CardTitle>
            <CardDescription>{configurationError}</CardDescription>
          </CardHeader>
          <CardContent>
            <p>
              Use the deployment guide to create your database, configure
              email/password sign-in, and connect this Vercel project.
            </p>
            <a
              className="text-link"
              href="https://github.com/kuwe77/casetrack/blob/main/DEPLOYMENT.md"
              target="_blank"
              rel="noreferrer"
            >
              Open setup guide ↗
            </a>
          </CardContent>
        </Card>
      </main>
    );
  if (loading)
    return (
      <main className="center-state">
        <LoaderCircle className="animate-spin" />
        <p>Checking your session…</p>
      </main>
    );
  if (!session) return <SignIn initialError="" />;
  // Remount all record-bearing state when the signed-in identity changes.
  return <div key={session.user.id}>{children}</div>;
}
function SignIn({ initialError }: { initialError: string }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error } = await client().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
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
        CaseTrack
      </a>
      <Card className="vault-card">
        <CardHeader>
          <CardTitle>Sign in to your workspace</CardTitle>
          <CardDescription>
            Use the account created by your deployment administrator.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="vault-form" onSubmit={submit}>
            <label>
              Email address
              <Input
                type="email"
                autoComplete="username"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <Input
                type="password"
                autoComplete="current-password"
                required
                maxLength={1024}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          </form>
          <p className="vault-help">
            Need an account or password reset? Contact the administrator of this
            CaseTrack deployment.
          </p>
        </CardContent>
      </Card>
      <p className="vault-footnote">Your firm’s workspace · Private access</p>
    </main>
  );
}
