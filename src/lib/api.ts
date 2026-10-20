export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options, credentials: "same-origin",
    headers: { ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.error || "Request failed.", response.status);
  return result as T;
}
export const send = <T = unknown>(path: string, body: unknown, method = "POST") => api<T>(path, { method, body: JSON.stringify(body) });
