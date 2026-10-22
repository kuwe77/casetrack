# CaseTrack

Conveyancing case management for law firms, hosted on Cloudflare Pages, Workers, D1 and private R2 storage. One account can create or join several workspaces. Each has separate records, members, WhatsApp settings and API keys. Use the workspace name in the sidebar or header to create, join or switch workspaces; new workspaces start empty. Switching reloads the dashboard and discards unsaved drafts.

## Features

- Public website, self-service registration, password login and single-use account recovery codes.
- Firm-isolated cases, property agents, follow-ups, notes, activity history and document uploads.
- Owner-managed private invitations; removing a member revokes their API keys.
- Per-user, per-firm API keys with scopes, expiration and revocation. Full API contract at `/api/openapi.json` and guide at `/api-docs.html`.
- WhatsApp through Zernio or direct Meta: connected inbox/history, delivery status, consent controls, manual/API sends and scheduled template updates. Preview mode is the default.

## Local development

Node.js 24 or later is required.

1. `npm ci`
2. Create `.dev.vars` containing `AUTH_SECRET=` followed by a cryptographically random secret of at least 32 characters. Never commit it. `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` can generate one locally.
3. `npm run build`
4. `npm run db:local`
5. In separate terminals: `npm run dev:api`, `npm run dev:scheduler`, and `npm run dev`.
6. Open `http://127.0.0.1:5173`. The frontend proxies `/api` to port 8788; the scheduled Worker runs on 8789.

`npm test` runs frontend/model and Zernio adapter regression tests. With both local Workers running, `npm run test:integration` checks real local D1/R2/auth behavior, cross-firm isolation, API permissions, account recovery and WhatsApp preview/webhook/scheduler behavior using synthetic records. It refuses remote endpoints and never sends live WhatsApp messages. Local test records remain in `.wrangler/`.

See [deployment](DEPLOYMENT.md), [WhatsApp setup](WHATSAPP.md), [security model](SECURITY.md), and [contributing](CONTRIBUTING.md).

## Operating limits

This is not unlimited hosting. Pages static assets, Worker execution, D1 queries/storage and R2 storage/operations have different Cloudflare quotas. Quotas generally accumulate across projects within an account. Native scrypt password hashing uses Cloudflare's Node compatibility; verify authentication on your actual plan. Do not weaken password hashing to fit a quota.

WhatsApp requires each firm's connected Zernio account or direct Meta setup, credentials and approved templates. Provider charges are separate. Account recovery uses saved recovery codes; automatic email verification/reset delivery is not configured. Owners share invitation links themselves.

## License

MIT. Preserve third-party license notices in `THIRD_PARTY.md` and `docs/`.
