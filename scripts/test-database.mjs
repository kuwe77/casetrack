import { spawnSync } from "node:child_process";
const value = process.env.TEST_DATABASE_URL;
if (!value)
  throw Error(
    "Set TEST_DATABASE_URL to an EMPTY local PostgreSQL database named casetrack_test. See CONTRIBUTING.md.",
  );
const url = new URL(value);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  url.pathname != "/casetrack_test"
)
  throw Error(
    "Tests only run against a local disposable database named casetrack_test.",
  );
for (const file of [
  "supabase/tests/bootstrap.sql",
  "supabase/migrations/202610110001_workspace.sql",
  "supabase/migrations/202610110002_whatsapp.sql",
  "supabase/tests/isolation.sql",
  "supabase/tests/whatsapp.sql",
]) {
  const run = spawnSync(
    "psql",
    ["-X", "-v", "ON_ERROR_STOP=1", "-q", "-f", file],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        PGHOST: url.hostname,
        PGPORT: url.port || "5432",
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGDATABASE: "casetrack_test",
      },
    },
  );
  if (run.error) throw run.error;
  if (run.status !== 0) process.exit(run.status || 1);
}
console.log("PostgreSQL workspace isolation checks passed.");
