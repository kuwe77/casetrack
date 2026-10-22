export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export type WorkspaceMembership = { id: string; name: string; email: string; role: "owner" | "member" };
const selectionKey = "casetrack-workspace";
// This value is fixed for the lifetime of a dashboard. Switching navigates to a
// fresh page so drafts, pending requests and callbacks cannot cross workspaces.
let workspaceId: string | null = null;
export function currentWorkspaceId() { return workspaceId; }
export async function initializeWorkspace() {
  const memberships = await api<WorkspaceMembership[]>("/workspaces");
  const saved = sessionStorage.getItem(selectionKey);
  workspaceId = memberships.find(w => w.id === saved)?.id || memberships[0]?.id || null;
  if (workspaceId) sessionStorage.setItem(selectionKey, workspaceId);
  else sessionStorage.removeItem(selectionKey);
  return memberships;
}
export function openWorkspace(id: string) {
  sessionStorage.setItem(selectionKey, id);
  // Assigning the same URL with a hash is only a fragment navigation.
  if (window.location.pathname === "/app") window.location.reload();
  else window.location.assign(`/app${window.location.hash}`);
}
export function workspaceDownloadUrl(id: string) {
  return `/api/v1/documents/${encodeURIComponent(id)}/download${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ""}`;
}
export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (workspaceId) headers.set("X-Workspace-Id", workspaceId);
  const response = await fetch(`/api/v1${path}`, {
    ...options, credentials: "same-origin",
    headers,
  });
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.error || "Request failed.", response.status);
  return result as T;
}
export const send = <T = unknown>(path: string, body: unknown, method = "POST") => api<T>(path, { method, body: JSON.stringify(body) });
