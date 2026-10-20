// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
const mocks = vi.hoisted(() => ({ session: { data: null as null | { user: { id: string } }, isPending: false, error: null }, signIn: vi.fn(), signUp: vi.fn() }));
vi.mock("../lib/auth-client", () => ({ authClient: {
  useSession: () => mocks.session, signIn: { email: mocks.signIn }, signUp: { email: mocks.signUp },
} }));
import { AuthGate } from "./auth-gate";
beforeEach(() => { history.replaceState(null, "", "/app"); mocks.session = { data: null, isPending: false, error: null }; });
afterEach(cleanup);
describe("account boundary", () => {
  it("unmounts private workspace state when the account changes", () => {
    function Private() { const [value,set] = useState(""); return <input aria-label="private note" value={value} onChange={e=>set(e.target.value)}/>; }
    mocks.session.data = { user: { id: "first" } };
    const view = render(<AuthGate><Private/></AuthGate>);
    fireEvent.change(screen.getByLabelText("private note"), { target: { value: "Firm A confidential" } });
    mocks.session.data = { user: { id: "second" } };
    view.rerender(<AuthGate><Private/></AuthGate>);
    expect((screen.getByLabelText("private note") as HTMLInputElement).value).toBe("");
  });
  it("shows login instead of protected content after sign out", () => {
    const view = render(<AuthGate>Private firm data</AuthGate>);
    expect(screen.queryByText("Private firm data")).toBeNull();
    expect(screen.getByRole("button", { name: /^Sign in$/ })).toBeDefined();
    view.unmount();
  });
  it("captures invitations in the tab and removes the secret from the URL", () => {
    const token = "a".repeat(64);
    history.replaceState(null, "", `/join#${token}`);
    render(<AuthGate>Private</AuthGate>);
    expect(sessionStorage.getItem("casetrack-invitation")).toBe(token);
    expect(location.hash).toBe("");
    expect(screen.getByRole("button", { name: "Create account" })).toBeDefined();
  });
});
