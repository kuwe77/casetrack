import { configurationIssue } from "./configuration";
import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const configurationError = configurationIssue(url, key);
export const supabase = configurationError
  ? null
  : createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
export function client() {
  if (!supabase)
    throw Error(configurationError || "Supabase is not configured.");
  return supabase;
}
