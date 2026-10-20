import { HTTPException } from "hono/http-exception";
import type { Env } from "./types";

export const scopeNames = [
  "workspace:read",
  "cases:read", "cases:write", "agents:read", "agents:write",
  "tasks:read", "tasks:write", "activities:read", "notes:write",
  "documents:read", "documents:write", "whatsapp:read", "whatsapp:write",
  "assistant:reply",
] as const;
export const now = () => new Date().toISOString();
export function token(prefix = "") {
  return prefix + Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
}
export async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
}
export function fail(status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503, message: string): never {
  throw new HTTPException(status, { message });
}
export async function rateLimit(env: Env, key: string, limit = 120, seconds = 60) {
  const window = Math.floor(Date.now() / (seconds * 1000));
  const bucket = `${key}:${window}`;
  const r = await env.DB.prepare("INSERT INTO api_usage(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count")
    .bind(bucket, (window + 2) * seconds * 1000).first<{ count: number }>();
  if ((r?.count || 0) > limit) fail(429, "Too many requests. Please try again later.");
}
export async function encrypt(env: Env, value: string) {
  const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.AUTH_SECRET)), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...iv, ...data));
}
export async function decrypt(env: Env, value: string) {
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.AUTH_SECRET)), "AES-GCM", false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12)));
}
