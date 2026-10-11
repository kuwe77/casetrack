# WhatsApp case progress with Zernio + Hermes

CaseTrack's optional WhatsApp worker polls the Zernio inbox, answers registered property agents about their own cases, and runs configurable case follow-ups. There is no webhook endpoint or cron job. Vercel hosts the dashboard, Supabase stores authorization/settings/events, and an **always-on Node.js 24+ worker** runs on your WSL machine, computer or server. If that machine sleeps, polling stops.

## What is shared

Every inquiry is matched against a workspace-owner-approved international phone number, the current phone on the agent record, and the case's current `agent_id`. No country code is guessed. Use `+60123456789`, not a local `012…` number. Groups, outbound messages, unknown senders, edited/deleted messages, and account/sender mismatches are ignored or blocked.

The model receives only the inquiry and the sender's assigned case references. It selects an intent, language and reference; it cannot select a recipient, execute tools, update the database, or supply the outgoing message. After inference the worker checks authorization again and builds the reply from the **latest database values**: case reference, stage, optional target date and an owner-approved shared update. Internal notes, buyer/seller details, addresses and financial values are excluded. Requests for another agent's case get the same denial whether that case exists or not. Ambiguous questions ask for a reference.

The supported model route uses an existing Hermes installation's tool-free `call_llm` interface and its configured provider. You can select a configured Meta Muse provider/model through the worker environment; there is no separately verified Muse-specific adapter. It does not call the owner's general-purpose Hermes agent session or expose terminal, memory or messaging tools to incoming WhatsApp text. This bridge uses Hermes internals; run the doctor after Hermes upgrades.

## 1. Update the database and app

First complete [DEPLOYMENT.md](DEPLOYMENT.md). Existing installations that have the first migration must run only `supabase/migrations/202610110002_whatsapp.sql`. New installations run **both migrations in filename order**. Redeploy the frontend. Do not run the disposable test SQL on Supabase.

Sign in as workspace owner and open **WhatsApp**. Only owners can read or change integration settings, agent approvals, rules and message logs. A worker token grants access to this one workspace's limited WhatsApp RPC; it is not a Supabase service-role key. Generate/replace it in this tab and save it privately. Rotation immediately revokes the old token. The database stores only its SHA-256 hash.

## 2. Install Zernio CLI on the worker machine

```sh
npm install -g @zernio/cli
zernio auth:login
chmod 600 ~/.zernio/config.json
zernio accounts:list
```

Follow the [official Zernio CLI guide](https://docs.zernio.com/cli). The CLI saves the key in `~/.zernio/config.json`. CaseTrack reads that file; `ZERNIO_API_KEY` overrides it if already set. Check that environment variable before using a different account. Never paste a key into the dashboard or a `VITE_` variable. CaseTrack pins requests to `https://zernio.com/api/v1`; custom API-origin overrides are not supported.

If you have multiple Zernio accounts, check the returned account ID, platform **whatsapp**, active state and number. Do not choose the first account. Pin the same ID in the dashboard and worker environment. The worker re-verifies the account against Zernio on every poll and refuses a mismatch. It does not switch accounts automatically.

The implementation polls Zernio's documented conversation/message REST endpoints directly using the CLI's saved credentials. There is no assumed `zernio poll` CLI command. It walks cursor pages, never marks messages read, and sends no read receipts. Polling may consume API quota. The current worker scans at most 10,000 conversations/messages per listing and fails closed if that limit is exceeded.

## 3. Configure the worker

Clone this repository onto the always-on machine. Copy `worker/.env.example` to a private file **outside the repository**, for example `~/.config/casetrack/worker.env`, with directory mode 700 and file mode 600. Fill in:

- `CASETRACK_SUPABASE_URL` and `CASETRACK_SUPABASE_PUBLISHABLE_KEY`: the same project as the dashboard.
- `CASETRACK_WORKER_TOKEN`: the token generated in WhatsApp.
- `CASETRACK_WHATSAPP_ACCOUNT_ID`: the verified connected WhatsApp account ID.
- `HERMES_SOURCE`: the installed Hermes source directory.
- `HERMES_PYTHON`: Python from the active Hermes installation, with its dependency environment. Current managed Hermes installs activate dependencies through `hermes_bootstrap`; older virtualenv installs need their `.venv/bin/python`.
- Optional `HERMES_HOME`, `CASETRACK_MODEL_PROVIDER`, `CASETRACK_MODEL` to select an existing Hermes profile/provider/model. The default uses Hermes's configured provider and model.

No Supabase secret/service-role key is required. Keep worker credentials separate from frontend deployment variables.

```sh
node --env-file="$HOME/.config/casetrack/worker.env" worker/index.mjs --doctor
```

The doctor verifies the pinned WhatsApp account and asks Hermes to classify a **synthetic** reference. It does not send WhatsApp messages or require Supabase. Then run one preview poll:

```sh
node --env-file="$HOME/.config/casetrack/worker.env" worker/index.mjs --once
```

For continuous polling:

```sh
node --env-file="$HOME/.config/casetrack/worker.env" worker/index.mjs
```

A sample user-level systemd unit is supplied at `worker/casetrack-whatsapp.service`. Set its checkout path, Node executable/PATH and environment file for your machine before installing it under `~/.config/systemd/user/`. Use `systemctl --user enable --now casetrack-whatsapp` after preview acceptance. It uses a long-running poll loop, not cron. Configure the host to stay awake. Do not run the worker inside a Vercel function.

## 4. Approve agents and cases

1. Store the exact international WhatsApp number in **Agents** and assign the correct agent to each case.
2. In **WhatsApp → Verified agent numbers**, verify the person owns that number, enter it exactly, and enable identity verification. Record follow-up consent before enabling scheduled messages. A changed agent phone invalidates the old approval.
3. Enter the pinned Zernio account ID. Keep **Preview only** checked and enable polling. Enabling from paused starts a new inbound cutoff, so historical messages are not answered.
4. Configure each case's mode (**ask for an update** or **send current progress**), recurrence and first due date. Completed/on-hold cases are skipped. A blank shared update sends only the recorded stage/date; approving shared text makes it externally visible even when scheduled follow-ups are off.
5. Start the worker, send an inquiry from an explicitly approved test number, and review **Recent activity**. Test unknown numbers, another agent's reference, case reassignment and STOP.
6. Turn off preview mode only after reviewing the results. This enables external sends to approved numbers under your rules. Preview events are not replayed into live messages. The next scheduled follow-up advances after previews/blocked/failed attempts too; set its next due time if needed.

STOP, UNSUBSCRIBE, BERHENTI or HENTI disables the sender's approval and follow-up consent. The firm must explicitly reapprove after obtaining consent again. Inbound updates are not treated as verified case changes: staff review messages in Zernio and update CaseTrack themselves.

## WhatsApp templates and reply window

Freeform replies are restricted to a recent inbound customer-service window (the worker uses a conservative 23-hour limit). Outside it, scheduled messages require an approved template. In Zernio/Meta, create a **text-only template with exactly one body variable**, containing the case message, and enter its exact name/language in the rule. No media header or variable buttons are supported by this version. Zernio verifies approval before sending; invalid templates fail rather than falling back to an unrestricted text message. [Zernio templates and inbox](https://docs.zernio.com/messages/create-inbox-conversation)

## Reliability and operational boundaries

- Durable event IDs and database uniqueness prevent repeated polls/workers from sending the same event twice. Each number is limited to one new reservation per minute.
- Database authorization, consent and current assignment are checked again after model inference. A remote send cannot be atomic with a database edit: an edit made after that final check may occur while a request is already in flight.
- Sends use Zernio idempotency keys. A timeout/ambiguous result is marked **uncertain** and is not automatically retried. Check Zernio before any manual resend. A process crash can leave **processing** records; treat these the same way. This favors avoiding duplicate confidential messages over guaranteed delivery.
- **Sent** means API acceptance, not delivery confirmation. Delivery receipts are checked in Zernio; this release does not mirror them.
- No case contents or incoming message bodies are printed in worker logs. The dashboard stores outgoing previews/replies and minimal event metadata; owners should define retention for these records in their backup/privacy procedures.
- Polling failure backs off. The last successful poll is visible in the dashboard; a stopped worker will show an old timestamp. Preview checks do not prove a live deployment or delivery.

## Verification

```sh
npm test
npm run test:worker
npm run build
# Disposable local PostgreSQL only; see CONTRIBUTING.md.
npm run test:database
```

The tests cover sender/account identity, cross-agent and cross-workspace isolation, token rotation, reassignment, phone changes, STOP replay prevention, preview mode, duplicate claims, uncertain sends and model failure. Production acceptance still requires your own configured Supabase project and an approved test WhatsApp recipient.
