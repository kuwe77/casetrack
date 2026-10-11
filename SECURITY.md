# Security model

CaseTrack is a Vercel frontend backed by your own Supabase project. It is an early release with tested access controls, not an independent security certification.

## Access boundaries

- **Authentication:** Supabase verifies email/password sessions. Public signup must be disabled; the deployment administrator provisions confirmed accounts after verifying the person. There is no anonymous workspace access, public registration or automatic demo fallback.
- **Workspace isolation:** all seven app tables enable RLS. Membership is derived from `auth.uid()`, not a caller-supplied firm ID. Each user belongs to one workspace. Members can read and edit that workspace's records; only its owner changes firm details, invites or removes members.
- **Membership:** clients cannot insert/update members or owner IDs directly. Restricted functions validate owner identity. Invitations match the verified Auth email, expire after seven days, and are consumed transactionally. Removal blocks subsequent database requests even when the user's existing Auth token remains valid.
- **References:** composite foreign keys prevent linking a case/task to another workspace's contact/case. Server constraints check statuses, dates, priorities, monetary bounds, lengths and unique case references. Record identity cannot be moved between workspaces.
- **Activity:** database triggers append case/contact/task history in the same transaction as writes. Notes use an authorized function. Activity identity/time comes from the database; app clients cannot forge, update or delete activity records. Database administrators can modify data, so this is not an independently tamper-proof log.
- **Privileged functions:** empty search paths, qualified objects, explicit Auth checks, and restricted execute grants. Supabase secret/service-role credentials are never required in the frontend. The UI rejects them as configuration, but deployers must also review environment values: never put secrets in any `VITE_` variable.
- **Browser:** Vercel headers restrict scripts to self, connections to Supabase HTTPS, block framing and MIME sniffing, and disable camera/microphone/geolocation. Inline styles remain enabled for UI components. React escapes text; CSV exports escape spreadsheet formula prefixes.

## Limits and responsibilities

Data is stored in your Supabase database, not the former local AES-GCM vault. This is not end-to-end encryption: your database administrator and hosting providers operate the infrastructure. Select suitable regions, plans, policies and backups for your firm's requirements. Configure and verify backups and restores yourself.

Supabase Auth tokens persist in browser storage to keep users signed in. Case records are held in memory, not deliberately persisted in localStorage, but the browser/OS may retain memory and downloads. A compromised browser, XSS, extension, unlocked device, or stolen session may expose accessible records. Sign out on shared computers. Membership revocation cannot recall information already viewed or exported. The app rechecks data on focus and every minute.

All members of a workspace can edit all its case records. There is no per-case access control, enforced MFA, granular read-only role, ownership transfer, file upload or workspace deletion UI yet. Updates use last-write-wins; coordinate edits. Workspace reads return the full record set and suit modest workspaces, not unbounded archives. Supabase API limits, Auth rate limits and service quotas apply.

A deployment administrator can reset credentials through Supabase's server-only Admin API. No SMTP service is required for the supported workflow; email invitation/recovery buttons in the Supabase dashboard may require SMTP and are not the documented account flow. Configure appropriate password requirements and disable unused Auth providers, anonymous sign-in and public signup.

Do not expose the old unauthenticated local server. It is removed from the hosted source. Do not commit or deploy legacy `data/`, `.env.local`, database backups, encryption keys or exports. No automatic legacy upload/import occurs.

## Validation

PostgreSQL tests exercise anonymous denial, cross-workspace reads/writes, membership escalation, verified-email invitation acceptance, forged audit writes, reference integrity and access revocation. The test harness simulates Supabase Auth claims; it does not run Supabase Auth or PostgREST. Complete the real deployment checks in DEPLOYMENT.md before handling confidential data.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/kuwe77/casetrack/security/advisories/new). Never post records, passwords, access tokens, keys or database files publicly. Include the affected version and reproduction using fictional records. If private reporting is unavailable, request a private contact without exploit details. Reports are handled on a best-effort basis.
