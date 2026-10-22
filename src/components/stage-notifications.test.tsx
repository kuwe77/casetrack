// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CaseRecord } from "../lib/model";
const mocks = vi.hoisted(() => ({ api: vi.fn(), send: vi.fn() }));
vi.mock("../lib/api", () => mocks);
import { StageNotifications } from "./stage-notifications";
import { MuseSetup } from "./muse-setup";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("requires an explicit per-stage choice and saves only the clerk's approved text", async () => {
  mocks.api.mockResolvedValue({ rules: [], jobs: [], contact_ready: true, enabled: true });
  mocks.send.mockResolvedValue({ success: true });
  const user = userEvent.setup();
  render(<StageNotifications record={{ id: "kelvin-case", buyer: "Kelvin Lim", ref: "DEMO/018", status: "loan", agent_id: "zakwan" } as CaseRecord} agentName="Zakwan"/>);
  await screen.findByRole("checkbox", { name: "Stamping & transfer" });
  expect(screen.getAllByRole("checkbox").some(el => (el as HTMLInputElement).checked)).toBe(false);
  await user.click(screen.getByRole("checkbox", { name: "Stamping & transfer" }));
  const message = screen.getByRole("textbox", { name: "Stamping & transfer message" });
  expect((message as HTMLTextAreaElement).value).toContain("Kelvin Lim");
  await user.clear(message); await user.type(message, "Kelvin’s case has reached stamping and transfer.");
  expect(mocks.send).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save notification choices" }));
  await screen.findByRole("status");
  const [path, payload, method] = mocks.send.mock.calls[0];
  expect(path).toBe("/cases/kelvin-case/stage-notifications"); expect(method).toBe("PUT");
  expect(payload.rules.filter((rule: { enabled: boolean }) => rule.enabled)).toEqual([
    { stage: "stamping", enabled: true, message: "Kelvin’s case has reached stamping and transfer." },
  ]);
});
it("copies the Muse-only upgrade prompt including the explicit follow-up flag and fresh proxy rules", async () => {
  mocks.api.mockResolvedValue({ enabled: 0, template_name: "", template_language: "en", owner: false });
  const user = userEvent.setup(), copied = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(<MuseSetup/>);
  await user.click(screen.getByRole("button", { name: "Copy stage follow-up prompt" }));
  await waitFor(() => expect(copied).toHaveBeenCalledTimes(1));
  const text = copied.mock.calls[0][0];
  expect(text).toContain("For Meta Muse agents only");
  expect(text).toContain("poll --include-followups");
  expect(text).toContain("Never save proxy passwords");
  expect(text).toContain("notification.approved_message");
  expect(text).toContain("numbered list (1., 2., 3.)");
  expect(text).toContain("client_name and ref");
  expect(text).toContain("Reuse them; do not ask for a token");
});
