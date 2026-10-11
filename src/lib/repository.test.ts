import { describe, it, expect, vi, beforeEach } from "vitest";
const api = vi.hoisted(() => ({ rpc: vi.fn(), upsert: vi.fn() }));
vi.mock("./supabase", () => ({
  client: () => ({ rpc: api.rpc, from: () => ({ upsert: api.upsert }) }),
}));
import { loadWorkspace, saveCase, addNote } from "./repository";
import { makeSeed } from "./seed";
beforeEach(() => vi.clearAllMocks());
describe("Supabase record adapter", () => {
  it("normalizes nullable dates and numeric values for existing dashboard workflows", async () => {
    const data = makeSeed();
    const row = { ...data.cases[0], due_date: null, value: "420000.25" };
    api.rpc.mockResolvedValue({
      data: {
        ...data,
        cases: [row],
        tasks: [{ ...data.tasks[0], due_date: null }],
      },
      error: null,
    });
    const w = await loadWorkspace();
    expect(w?.cases[0].due_date).toBe("");
    expect(w?.cases[0].value).toBe(420000.25);
    expect(w?.tasks[0].due_date).toBe("");
  });
  it("returns no workspace for an unaffiliated account", async () => {
    api.rpc.mockResolvedValue({ data: null, error: null });
    expect(await loadWorkspace()).toBeNull();
  });
  it("does not suppress backend access errors", async () => {
    api.upsert.mockResolvedValue({
      error: { message: "row-level security denied" },
    });
    await expect(saveCase(makeSeed().cases[0])).rejects.toMatchObject({
      message: "row-level security denied",
    });
  });
  it("uses nullable database dates and leaves the input unchanged", async () => {
    api.upsert.mockResolvedValue({ error: null });
    const c = { ...makeSeed().cases[0], due_date: "" };
    await saveCase(c);
    expect(api.upsert.mock.calls[0][0].due_date).toBeNull();
    expect(c.due_date).toBe("");
  });
  it("leaves note workspace and actor authority to the database", async () => {
    api.rpc.mockResolvedValue({ error: null });
    await addNote("forged-firm", "case-id", "A note");
    expect(api.rpc).toHaveBeenCalledWith("add_note", {
      target_case: "case-id",
      note_text: "A note",
    });
  });
});
