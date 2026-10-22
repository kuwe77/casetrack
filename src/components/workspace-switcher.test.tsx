// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("../lib/api", () => ({ api: vi.fn(), send: vi.fn(), openWorkspace: vi.fn() }));
import { api, send, openWorkspace } from "../lib/api";
import { WorkspaceSwitcher } from "./workspace-switcher";
afterEach(() => { cleanup(); vi.resetAllMocks(); sessionStorage.clear(); });
function setup(initialJoin = false) {
  vi.mocked(api).mockResolvedValue([{ id: "a", name: "Kuala Lumpur", role: "owner" }, { id: "b", name: "Penang", role: "member" }]);
  render(<WorkspaceSwitcher currentId="a" onClose={vi.fn()} initialJoin={initialJoin}/>);
  return userEvent.setup();
}
it("shows membership names and switches to the chosen workspace", async () => {
  const user = setup(); await user.click(await screen.findByRole("button", { name: "Open workspace: Penang" }));
  expect(openWorkspace).toHaveBeenCalledWith("b");
});
it("creates an empty named workspace and opens its returned ID", async () => {
  const user = setup(); vi.mocked(send).mockResolvedValue({ id: "new" });
  await user.click(screen.getByRole("button", { name: "Create workspace" }));
  await user.type(screen.getByLabelText("Workspace name"), "Johor office");
  await user.click(screen.getByRole("button", { name: "Create workspace" }));
  expect(send).toHaveBeenCalledWith("/workspace", { name: "Johor office" }); expect(openWorkspace).toHaveBeenCalledWith("new");
});
it("lets existing accounts accept a saved invitation and leaves failed requests retryable", async () => {
  sessionStorage.setItem("casetrack-invitation", "a".repeat(64));
  const user = setup(true); vi.mocked(send).mockRejectedValueOnce(Error("Invitation expired.")).mockResolvedValueOnce({ id: "joined" });
  await user.click(screen.getByRole("button", { name: "Accept invitation" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Invitation expired."); expect(openWorkspace).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Accept invitation" }));
  expect(send).toHaveBeenLastCalledWith("/invitations/accept", { token: "a".repeat(64) }); expect(openWorkspace).toHaveBeenCalledWith("joined");
  expect(sessionStorage.getItem("casetrack-invitation")).toBeNull();
});
