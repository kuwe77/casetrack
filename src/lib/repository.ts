import type { Workspace, CaseRecord, Agent, FollowUp, Firm } from "./model";
import { client } from "./supabase";
export async function rpc<T = unknown>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client().rpc(name, args);
  if (error) throw error;
  return data as T;
}
export async function loadWorkspace(): Promise<Workspace | null> {
  const w = await rpc<Workspace | null>("get_workspace");
  if (!w) return null;
  w.cases = w.cases.map((c) => ({
    ...c,
    due_date: c.due_date || "",
    value: Number(c.value),
  }));
  w.tasks = w.tasks.map((t) => ({ ...t, due_date: t.due_date || "" }));
  return w;
}
async function save(table: string, record: object) {
  const { error } = await client().from(table).upsert(record);
  if (error) throw error;
}
export const saveCase = (c: CaseRecord) =>
  save("cases", { ...c, due_date: c.due_date || null });
export const saveAgent = (a: Agent) => save("agents", a);
export const saveTask = (t: FollowUp) =>
  save("tasks", { ...t, due_date: t.due_date || null });
export async function saveFirm(f: Firm) {
  const { data, error } = await client()
    .from("firms")
    .update({ name: f.name, email: f.email })
    .eq("id", f.id)
    .select("id");
  if (error) throw error;
  if (!data.length)
    throw Error("Only the workspace owner can change firm settings.");
}
export const addNote = (_firmId: string, caseId: string, note: string) =>
  rpc("add_note", { target_case: caseId, note_text: note });
export function errorMessage(e: unknown) {
  if (
    e &&
    typeof e === "object" &&
    "code" in e &&
    ["PGRST202", "42P01"].includes(String(e.code))
  )
    return "Database setup is missing. Run the CaseTrack migration in Supabase, then retry.";
  if (e && typeof e === "object" && "message" in e) return String(e.message);
  return "Something went wrong. Please try again.";
}
