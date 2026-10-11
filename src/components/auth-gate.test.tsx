// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: unknown) => void),
  password: vi.fn(),
  unsubscribe: vi.fn(),
  config: null as string | null,
}));
vi.mock("../lib/supabase", () => ({
  get configurationError() {
    return mocks.config;
  },
  supabase: {
    auth: {
      onAuthStateChange: (callback: typeof mocks.listener) => {
        mocks.listener = callback;
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
      },
    },
  },
  client: () => ({ auth: { signInWithPassword: mocks.password } }),
}));
import { AuthGate } from "./auth-gate";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.config = null;
});
function session(id: string | null) {
  act(() =>
    mocks.listener?.(
      id ? "SIGNED_IN" : "SIGNED_OUT",
      id ? { user: { id } } : null,
    ),
  );
}
describe("hosted authentication boundary", () => {
  it("hides records until sign-in and removes them on sign-out", () => {
    render(
      <AuthGate>
        <p>Private records</p>
      </AuthGate>,
    );
    expect(screen.queryByText("Private records")).toBeNull();
    session(null);
    expect(screen.getByLabelText("Password")).toBeTruthy();
    session("a");
    expect(screen.getByText("Private records")).toBeTruthy();
    session(null);
    expect(screen.queryByText("Private records")).toBeNull();
  });
  it("resets record-bearing component state when users change", () => {
    function Content() {
      const [value, setValue] = useState("");
      return (
        <input
          aria-label="Draft"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      );
    }
    render(
      <AuthGate>
        <Content />
      </AuthGate>,
    );
    session("a");
    fireEvent.change(screen.getByLabelText("Draft"), {
      target: { value: "Private draft" },
    });
    session("b");
    expect((screen.getByLabelText("Draft") as HTMLInputElement).value).toBe("");
  });
  it("uses email/password and displays provider errors without exposing records", async () => {
    mocks.password.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });
    render(
      <AuthGate>
        <p>Private records</p>
      </AuthGate>,
    );
    session(null);
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "test-password-only" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Invalid login credentials",
      ),
    );
    expect(mocks.password).toHaveBeenCalledWith({
      email: "test@example.com",
      password: "test-password-only",
    });
    expect(screen.queryByText("Private records")).toBeNull();
    expect(screen.queryByRole("button", { name: /sign up/i })).toBeNull();
  });
  it("shows setup guidance instead of records when configuration is missing", () => {
    mocks.config = "Missing Supabase connection";
    render(
      <AuthGate>
        <p>Private records</p>
      </AuthGate>,
    );
    expect(screen.getByText("Connect your Supabase project")).toBeTruthy();
    expect(screen.queryByText("Private records")).toBeNull();
  });
});
