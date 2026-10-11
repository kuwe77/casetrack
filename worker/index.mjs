import { credentials, Zernio } from "./zernio.mjs";
import { interpret } from "./model.mjs";
import { cycle } from "./engine.mjs";
const env = process.env;
const accountId = env.CASETRACK_WHATSAPP_ACCOUNT_ID;
if (!/^[a-zA-Z0-9_-]{1,100}$/.test(accountId || ""))
  throw Error(
    "Set CASETRACK_WHATSAPP_ACCOUNT_ID to the verified WhatsApp account",
  );
const api = new Zernio(credentials(), accountId);
if (process.argv.includes("--doctor")) {
  console.log("Zernio account verified:", await api.verify());
  const result = await interpret("What is the progress of TEST-001?", {
    cases: [{ ref: "TEST-001" }],
  });
  if (
    result.intent !== "status" ||
    result.refs.length !== 1 ||
    result.refs[0] !== "TEST-001"
  )
    throw Error("Model doctor returned an unexpected decision");
  console.log(
    "Hermes classification verified using synthetic input. No messages sent.",
  );
  process.exit(0);
}
if (
  !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(
    env.CASETRACK_SUPABASE_URL || "",
  ) ||
  !env.CASETRACK_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_") ||
  !/^[a-f0-9]{64}$/.test(env.CASETRACK_WORKER_TOKEN || "")
)
  throw Error(
    "Set the worker Supabase URL, publishable key, and workspace worker token",
  );
async function rpc(operation, payload = {}) {
  const r = await fetch(
    `${env.CASETRACK_SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/whatsapp_worker`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        apikey: env.CASETRACK_SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        worker_token: env.CASETRACK_WORKER_TOKEN,
        operation,
        payload,
      }),
    },
  );
  if (!r.ok) throw Error(`CaseTrack database HTTP ${r.status}`);
  return r.json();
}
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
console.log(
  "CaseTrack WhatsApp polling worker started. Mode is controlled by the workspace dashboard.",
);
do {
  let seconds = 60;
  try {
    seconds = await cycle({ api, rpc, interpret, accountId });
    console.log("Poll completed.");
  } catch {
    console.error(
      "Poll failed; no automatic send retry. Check account, model and database configuration.",
    );
    seconds = 120;
  }
  if (process.argv.includes("--once") || stopped) break;
  for (let i = 0; i < seconds && !stopped; i++)
    await new Promise((resolve) => setTimeout(resolve, 1000));
} while (!stopped);
