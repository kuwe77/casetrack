import type { Workspace, CaseRecord, Agent, FollowUp, Firm } from "./model";
import { api, send, ApiError } from "./api";
export async function loadWorkspace(): Promise<Workspace | null> {
  const metadata = await api<{ firm: Firm } | null>("/workspace");
  if (!metadata) return null;
  async function list<T>(resource: string): Promise<T[]> {
    let cursor: string | null = "", records: T[] = [];
    do {
      const page: { data: T[]; nextCursor: string | null } = await api(`/${resource}?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      records = records.concat(page.data); cursor = page.nextCursor;
    } while (cursor);
    return records;
  }
  const [cases, agents, tasks, activities] = await Promise.all([
    list<CaseRecord>("cases"), list<Agent>("agents"), list<FollowUp>("tasks"), list<Workspace["activities"][number]>("activities"),
  ]);
  return {
    firm: metadata.firm,
    cases: cases.map(c => ({ ...c, due_date: c.due_date || "", value: Number(c.value) })).sort((a,b) => b.updated_at.localeCompare(a.updated_at)),
    agents: agents.sort((a,b) => a.name.localeCompare(b.name)),
    tasks: tasks.map(t => ({ ...t, due_date: t.due_date || "", completed: !!t.completed })),
    activities: activities.sort((a,b) => b.created_at.localeCompare(a.created_at)),
  };
}
async function save(table: string, record: { id: string }) {
  let exists = false;
  try { await api(`/${table}/${record.id}`); exists = true; }
  catch (e) { if (!(e instanceof ApiError) || e.status !== 404) throw e; }
  return send(`/${table}${exists ? `/${record.id}` : ""}`, record, exists ? "PATCH" : "POST");
}
export const saveCase = (c: CaseRecord) => save("cases", c);
export const saveAgent = (a: Agent) => save("agents", a);
export const saveTask = (t: FollowUp) => save("tasks", t);
export const saveFirm = (f: Firm) => send("/workspace", { name: f.name, email: f.email }, "PATCH");
export const addNote = (_firmId: string, caseId: string, note: string) => send(`/cases/${caseId}/notes`, { note });
export function errorMessage(e: unknown) {
  return e && typeof e === "object" && "message" in e ? String(e.message) : "Something went wrong. Please try again.";
}
