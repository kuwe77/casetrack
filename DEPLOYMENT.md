# Deploy to Cloudflare

## Current instance (20 October 2026)

- Production website: https://casetrack.pages.dev
- Pages project: `casetrack`
- D1 database: `casetrack`, ID `384e3921-ab85-437b-a53c-3ba862fb2870`, APAC.
- Scheduled Worker: `casetrack-scheduler`, cron `*/5 * * * *`; public Worker/preview URLs disabled.
- A production cron run was verified at 03:40 UTC on 20 October 2026: Cloudflare reported `outcome: ok` with no exceptions, and the Worker removed an expired verification marker from D1.
- The site, authentication, agent API and document storage are deployed. The private R2 bucket `casetrack-documents` is bound as `FILES`; public `r2.dev` access is disabled and no custom bucket domains are connected.
- Current release: https://3af5d41e.casetrack.pages.dev. Scheduler version: `1404bf3d-f360-4984-be92-f013e168b538`. Migration `0005_zernio.sql` is applied locally and remotely.
- The production agent API passed checks covering firm metadata, membership, scoped keys, case/task/note updates, collection pagination, private document upload/download, WhatsApp history, and cross-firm isolation. `/api/health` reports `"files":true`. Anonymous document downloads return 401; authenticated downloads use attachment headers and `Cache-Control: no-store`.
- The consented Zernio test on 20 October 2026 completed a real round trip: one outgoing CaseTrack message was read, and the recipient's `CaseTrack OK` reply appeared in both the agent API and the browser inbox. Same-key retries did not send a duplicate. See [E2E results](E2E-RESULTS.md) for coverage and limits.
- Never expose a bucket publicly. API downloads enforce firm access.

The application uses Pages advanced-mode `_worker.js` for `/api/*`, D1 for accounts and firm records, private R2 for documents, and a separate scheduled Worker for follow-ups. Static assets bypass API execution through `_routes.json`.

## Resources and secrets

1. Authenticate Wrangler to the intended Cloudflare account. Use limited account/user read, Pages/D1 edit and Workers script edit permissions. R2 setup may require separate account permission and activation.
2. Create a D1 database named `casetrack`, an R2 bucket named `casetrack-documents`, and a Pages project named `casetrack` (or an available name). Keep R2 public access disabled.
3. Put the real D1 ID into both `wrangler.jsonc` and `wrangler.scheduler.jsonc`. Set the Pages project name and R2 bucket name to match the created resources.
4. Apply migrations with `npx wrangler d1 migrations apply casetrack --remote`.
5. Generate one strong `AUTH_SECRET` and save it as a Cloudflare secret for both the Pages project and scheduler. They must match because the scheduler decrypts provider credentials. Never put it in committed config, browser variables or logs.
6. Set Pages `APP_ORIGIN` to the final production HTTPS origin. Do not include a trailing slash. Only this origin may perform cookie-authenticated writes.
7. Build with `npm run build` and deploy using `npx wrangler pages deploy dist --project-name <project>`.
8. Deploy the scheduler with `npm run deploy:scheduler`. It checks up to ten due updates every five minutes.

R2 can require an enabled billing relationship even within its free allowance. Do not assume a zero bill or enable a paid plan without reviewing the account's terms. No paid plan is automatically enabled by this repository.

## Verify before inviting firms

Check `/api/health`, the public home, `/register`, `/login`, `/app`, `/privacy`, `/api-docs.html`, and `/api/openapi.json`. Run a synthetic signup/login/workspace/API/document smoke test against production and remove its records afterwards using an explicitly scoped maintenance operation. Never run the full local integration script against production. Confirm worker logs show no CPU-limit errors during password hashing.

Configure Zernio or direct Meta credentials and templates before expecting real WhatsApp sends. For Meta, subscribe to the messages webhook and verify signatures. For Zernio, verify the connected account, then retrieve conversations to reconcile incoming messages and delivery status. Run a consented test before enabling schedules.

## Operations

- Use the Cloudflare dashboard for D1 restore/exports, R2 retention/backups, Worker errors and usage/billing alerts. Define retention and recovery objectives for your service before onboarding confidential records.
- Free quotas are shared with other projects in the account. API rate limiting also uses D1 writes. A request can make several database reads/writes.
- Keep `.dev.vars`, Wrangler credentials and production secrets out of Git.
- Rotating `AUTH_SECRET` invalidates sessions and prevents old WhatsApp secrets being decrypted; re-enter provider credentials after rotation or migrate ciphertext with the old key under a controlled process.
- The production deployment may use the provided `pages.dev` hostname. When adding a custom domain, update `APP_ORIGIN`, redeploy, and update each Meta callback URL.
- Configure a distinct D1 database, R2 bucket and auth secret for any preview environment; never point an untrusted preview at production records.
