// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { WhatsAppPage } from "./whatsapp-page";
import type { Workspace } from "../lib/model";
const mock = vi.hoisted(() => ({ owner: true, rpc: vi.fn(), from: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  client: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    from: mock.from,
  }),
}));
vi.mock("../lib/repository", () => ({
  rpc: mock.rpc,
  errorMessage: (e: Error) => e.message,
}));
const w: Workspace = {
  firm: { id: "firm", name: "Test workspace", email: "" },
  agents: [],
  cases: [],
  tasks: [],
  activities: [],
};
beforeEach(() => {
  mock.owner = true;
  mock.rpc.mockReset();
  mock.from.mockImplementation((name: string) => {
    const result = {
      data:
        name === "workspace_members"
          ? [{ user_id: "owner", role: mock.owner ? "owner" : "member" }]
          : name === "whatsapp_settings"
            ? null
            : [],
      error: null,
    };
    const q = {
      select: () => q,
      maybeSingle: () => Promise.resolve(result),
      order: () => q,
      limit: () => Promise.resolve(result),
      then: (resolve: (v: typeof result) => unknown) =>
        Promise.resolve(result).then(resolve),
    };
    return q;
  });
});
afterEach(cleanup);
describe("WhatsApp settings", () => {
  it("restricts integration controls to workspace owner", async () => {
    mock.owner = false;
    render(<WhatsAppPage w={w} />);
    await screen.findByText("Owner access required");
    expect(mock.from).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Save connection")).toBeNull();
  });
  it("defaults to paused preview and saves only integration configuration", async () => {
    render(<WhatsAppPage w={w} />);
    const account = await screen.findByLabelText("Zernio WhatsApp account ID");
    expect(
      (screen.getByLabelText(/Preview only/) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText(/Enable polling/) as HTMLInputElement).checked,
    ).toBe(false);
    fireEvent.change(account, { target: { value: "test-whatsapp-account" } });
    fireEvent.click(screen.getByText("Save connection"));
    await waitFor(() =>
      expect(mock.rpc).toHaveBeenCalledWith("configure_whatsapp", {
        settings: expect.objectContaining({
          account_id: "test-whatsapp-account",
          enabled: false,
          dry_run: true,
        }),
      }),
    );
  });
});
