export function configurationIssue(url?: string, key?: string): string | null {
  if (!url?.trim() || !key?.trim())
    return "Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, then rebuild the app.";
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url.trim()))
    return "Use the HTTPS Project URL from your Supabase Connect panel.";
  if (!key.trim().startsWith("sb_publishable_"))
    return "Use a Supabase publishable key (sb_publishable_…), never a secret or service-role key.";
  return null;
}
