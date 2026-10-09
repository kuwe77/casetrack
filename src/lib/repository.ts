import type { Workspace, CaseRecord, Agent, FollowUp, Firm } from "./model";
export async function localApi<T = unknown>(
  route: string,
  data?: unknown,
): Promise<T> {
  const res = await fetch(`/api/${route}`, {
    method: data === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-CaseTrack-Client": "local",
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  if (!res.headers.get("content-type")?.includes("application/json"))
    throw Error("Start CaseTrack with npm start or npm run dev.");
  const result = await res.json();
  if (res.status === 401) window.dispatchEvent(new Event("casetrack:locked"));
  if (!res.ok) throw Error(result.error || "Could not complete request.");
  return result;
}
export const loadWorkspace = () => localApi<Workspace>("workspace");
export const saveCase = (record: CaseRecord) => localApi("cases", record);
export const saveAgent = (record: Agent) => localApi("agents", record);
export const saveTask = (record: FollowUp) => localApi("tasks", record);
export const saveFirm = (record: Firm) => localApi("firm", record);
export const addNote = (firm_id: string, case_id: string, note: string) =>
  localApi("notes", { firm_id, case_id, note });
export async function lockWorkspace() {
  await localApi("lock", {});
  window.dispatchEvent(new Event("casetrack:locked"));
}
export function errorMessage(e: unknown) {
  if (e && typeof e === "object" && "message" in e) return String(e.message);
  return "Something went wrong. Please try again.";
}
