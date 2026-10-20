# End-to-end verification — 20 October 2026

Production: https://casetrack.pages.dev

Pages release: https://3af5d41e.casetrack.pages.dev

Scheduler version: `1404bf3d-f360-4984-be92-f013e168b538`

## Real WhatsApp round trip

With the owner's explicit authorization, CaseTrack used the existing Zernio credential from the WSL Hermes installation. It was stored encrypted in the demo firm's provider settings; it was not exposed through the agent API or committed to source.

The recipient initiated the conversation at 14:06:40 MYT. At approximately 14:27:23 MYT, the external-agent API sent exactly one test message through CaseTrack and Zernio. Zernio reported `read`; the recipient replied `CaseTrack OK` at 14:27:45 MYT. Both the authenticated API and the production browser inbox displayed this reply. The browser console had no errors.

The test used `E2E/f926aa25` in Meridian Legal — Demo. The synthetic case, completed task, note, contact and text document remain as visible evidence. The two temporary demo API keys were revoked and subsequently returned 401. The separate synthetic isolation firm and its account were removed.

## Verified coverage

- 21 unit tests: frontend/model behavior and Zernio adapter boundaries, including account isolation, pagination, provider failures, safe redirects and Cloudflare's fetch calling convention.
- 66 local Cloudflare integration checks: real local D1/R2/auth flows, scopes, firm isolation, member removal, private documents, CSRF, signed Meta webhook handling, preview sends, scheduler behavior and recovery.
- Production agent API: firm metadata and membership; cases, contacts, tasks, notes, activity and document reads/writes; full record pagination; exact-content document upload/download; WhatsApp conversation and message pagination; and delivery status reconciliation.
- Production permission checks: anonymous and revoked keys rejected, read-only keys cannot write or send, API keys cannot retrieve/change provider credentials or mint keys, and a separate firm's key cannot access or alter the test firm's records, documents or WhatsApp.
- Duplicate prevention: repeating the same idempotency key returned the original send; changing its payload returned 409. Provider history contained exactly one test message.

## Fixed during verification

Cloudflare Workers rejects `fetch` with `redirect: "error"`. Provider requests now use `manual`, reject non-success responses, and never follow credential-bearing redirects. The fetch wrapper also preserves the Workers calling convention.

## Practical limits

Zernio inbox updates are retrieved on Refresh or by API polling. Agents must follow `nextCursor` until null to export available history; provider retention and limits still apply. Credentials, invitation secrets and authentication records are deliberately excluded from agent data access.

The live test covers Zernio free-text sending, receiving and read status. Direct Meta delivery and live scheduled template delivery were not sent in production; their local webhook/preview/scheduler paths were tested. Automatic schedules remain off in the demo firm.

Create a key in **Settings → API access** for each real agent, selecting only its required scopes. Public guide: https://casetrack.pages.dev/api-docs.html. Machine-readable contract: https://casetrack.pages.dev/api/openapi.json.
