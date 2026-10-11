// Deployment administrator only. Never import into the frontend or a public endpoint.
import { createClient } from "@supabase/supabase-js";
const { SUPABASE_URL, SUPABASE_SECRET_KEY, NEW_PASSWORD } = process.env;
const userId = process.argv[2];
if (
  !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(SUPABASE_URL || "") ||
  !SUPABASE_SECRET_KEY?.startsWith("sb_secret_") ||
  !NEW_PASSWORD ||
  NEW_PASSWORD.length < 12 ||
  !/^[0-9a-f-]{36}$/i.test(userId || "")
) {
  console.error(
    "Provide SUPABASE_URL, SUPABASE_SECRET_KEY, NEW_PASSWORD (12+ characters), and the Auth user UUID. See DEPLOYMENT.md.",
  );
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error } = await admin.auth.admin.updateUserById(userId, {
  password: NEW_PASSWORD,
});
if (error) {
  console.error("Password reset failed:", error.message);
  process.exit(1);
}
console.log(
  "Password updated. Deliver it privately and ask the user to change it in Settings.",
);
