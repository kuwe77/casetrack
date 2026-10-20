// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Workspace } from "../lib/model";

const mocks = vi.hoisted(() => ({ api: vi.fn(), send: vi.fn() }));
vi.mock("../lib/api", () => mocks);
vi.mock("./account-security", () => ({ AccountSecurity: () => <h2>Account security</h2> }));
vi.mock("./workspace-team", () => ({ WorkspaceTeam: () => <h2>Workspace members</h2> }));
import { SettingsPage } from "./settings-page";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("selects every supported permission without submitting, supports clearing, and retains the draft and one-time key across sections", async () => {
  mocks.api.mockResolvedValue([]);
  mocks.send.mockResolvedValue({ key: "synthetic-key-visible-once" });
  const user = userEvent.setup();
  render(<SettingsPage w={{ firm: { id: "test", name: "Test firm", email: "" }, cases: [], agents: [] } as unknown as Workspace} onSave={vi.fn()}/>);
  await user.click(screen.getByRole("tab", { name: "API access" }));
  await screen.findByText("No current keys. Create one above to connect an integration.");
  expect(screen.getAllByRole("checkbox").filter(input => (input as HTMLInputElement).checked)).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getAllByRole("checkbox")).toHaveLength(13);
  expect(screen.getAllByRole("checkbox").every(input => (input as HTMLInputElement).checked)).toBe(true);
  expect(mocks.send).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Clear all" }));
  expect(screen.getAllByRole("checkbox").some(input => (input as HTMLInputElement).checked)).toBe(false);
  expect((screen.getByRole("button", { name: "Create API key" }) as HTMLButtonElement).disabled).toBe(true);
  await user.type(screen.getByRole("textbox", { name: "Key name" }), "My integration");
  await user.click(screen.getByRole("button", { name: "Select all" }));
  await user.click(screen.getByRole("tab", { name: "Profile" }));
  expect(screen.queryByRole("textbox", { name: "Key name" })).toBeNull();
  await user.click(screen.getByRole("tab", { name: "API access" }));
  expect((screen.getByRole("textbox", { name: "Key name" }) as HTMLInputElement).value).toBe("My integration");
  expect(screen.getAllByRole("checkbox").every(input => (input as HTMLInputElement).checked)).toBe(true);
  await user.click(screen.getByRole("button", { name: "Create API key" }));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith("/keys", {
    name: "My integration", days: 90,
    scopes: ["workspace:read", "cases:read", "cases:write", "agents:read", "agents:write", "tasks:read", "tasks:write", "documents:read", "documents:write", "whatsapp:read", "whatsapp:write", "activities:read", "notes:write"],
  }));
  await screen.findByText("synthetic-key-visible-once");
  await user.click(screen.getByRole("tab", { name: "Security" }));
  await user.click(screen.getByRole("tab", { name: "API access" }));
  expect(screen.getByText("synthetic-key-visible-once")).toBeTruthy();
});
