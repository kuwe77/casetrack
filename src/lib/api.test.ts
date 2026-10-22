// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); vi.resetModules(); });
it("keeps requests pinned to the opened workspace even if storage changes before navigation", async () => {
  sessionStorage.setItem("casetrack-workspace", "b");
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: "a" }, { id: "b" }] });
  vi.stubGlobal("fetch", fetcher);
  const client = await import("./api"); await client.initializeWorkspace();
  sessionStorage.setItem("casetrack-workspace", "a");
  await client.api("/cases", { headers: new Headers({ "Idempotency-Key": "existing-draft" }) });
  const headers = fetcher.mock.calls[1][1].headers as Headers;
  expect(headers.get("X-Workspace-Id")).toBe("b"); expect(headers.get("Idempotency-Key")).toBe("existing-draft");
  expect(client.workspaceDownloadUrl("doc")).toBe("/api/v1/documents/doc/download?workspace_id=b");
});
it("uses only memberships returned for the signed-in account and clears stale selection for new accounts", async () => {
  sessionStorage.setItem("casetrack-workspace", "someone-elses-workspace");
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => [{ id: "mine" }] }).mockResolvedValueOnce({ ok: true, json: async () => [] });
  vi.stubGlobal("fetch", fetcher);
  const client = await import("./api"); await client.initializeWorkspace();
  expect(client.currentWorkspaceId()).toBe("mine");
  await client.initializeWorkspace(); expect(client.currentWorkspaceId()).toBeNull(); expect(sessionStorage.getItem("casetrack-workspace")).toBeNull();
});
it("forces a full reload when switching on an existing app URL with a hash", async () => {
  const reload = vi.fn(), assign = vi.fn();
  vi.stubGlobal("window", { location: { pathname: "/app", hash: "#agents", reload, assign } });
  const client = await import("./api"); client.openWorkspace("next-workspace");
  expect(sessionStorage.getItem("casetrack-workspace")).toBe("next-workspace");
  expect(reload).toHaveBeenCalledOnce(); expect(assign).not.toHaveBeenCalled();
});
