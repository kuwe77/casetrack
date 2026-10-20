import { beforeEach, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ api: vi.fn(), send: vi.fn() }));
vi.mock("./api", () => ({ ...mocked, ApiError: class extends Error { constructor(message: string, public status: number) { super(message); } } }));
import { loadWorkspace, saveCase } from "./repository";
import { ApiError } from "./api";
import type { CaseRecord } from "./model";
beforeEach(() => vi.clearAllMocks());
it("loads every page instead of silently dropping records", async () => {
  mocked.api.mockImplementation(async (path: string) => {
    if (path === "/workspace") return { firm: { id: "firm" } };
    if (path === "/cases?limit=200") return { data: [{ id:"a", due_date:null, value:"100", updated_at:"2026-01-01" }], nextCursor:"a" };
    if (path === "/cases?limit=200&cursor=a") return { data: [{ id:"b", value:0, updated_at:"2026-02-01" }], nextCursor:null };
    return { data:[], nextCursor:null };
  });
  const result = await loadWorkspace();
  expect(result?.cases.map(c=>c.id)).toEqual(["b","a"]);
  expect(result?.cases[1].value).toBe(100);
});
it("does not turn a failed read into a create request", async () => {
  mocked.api.mockRejectedValue(new ApiError("Access denied",403));
  await expect(saveCase({id:"case"} as CaseRecord)).rejects.toThrow("Access denied");
  expect(mocked.send).not.toHaveBeenCalled();
});
