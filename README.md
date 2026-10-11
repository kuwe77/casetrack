# CaseTrack

**Open-source conveyancing case management, deployed on your own Vercel and Supabase projects.**

Track cases, property-agent contacts, milestones, follow-ups, internal notes and activity in a shadcn/ui dashboard. Each firm has a private workspace with owner-managed membership. There is no AI bot.

## Deploy your own copy

1. Create a Supabase project and run the supplied database migration.
2. Deploy to Vercel with your Supabase URL and publishable key.
3. Create a confirmed email/password account in Supabase, sign in, and name your workspace.

**[Follow the complete setup guide →](DEPLOYMENT.md)**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fkuwe77%2Fcasetrack&env=VITE_SUPABASE_URL,VITE_SUPABASE_PUBLISHABLE_KEY&envDescription=Use%20your%20Supabase%20Project%20URL%20and%20publishable%20key.&envLink=https%3A%2F%2Fgithub.com%2Fkuwe77%2Fcasetrack%2Fblob%2Fmain%2FDEPLOYMENT.md&project-name=casetrack&repository-name=casetrack)

Only Vercel and Supabase are required. Account provisioning is managed by the deployment administrator; sign-in uses email/password, so no SMTP/email provider is needed. The deployment button does not create the Supabase schema or accounts for you—complete the guide first.

## Features

- Case register with search, filters, table and board views.
- Conveyancing milestones, owners, property values and deadlines.
- Property-agent contacts, follow-ups, internal notes and activity history.
- Workspace creation, owner/member permissions, email-address invitations and membership removal.
- Email/password sign-in, sign-out and signed-in password changes.
- CSV export and light/dark themes, with desktop and mobile navigation.

“Agents” are property contacts. The interface uses Malaysian conveyancing stages, MYR and Asia/Kuala_Lumpur business dates. Each account belongs to one workspace; members share the workspace's records.

## Architecture and data

Vercel serves the Vite/React application. Supabase Auth verifies users; PostgreSQL row-level security and constrained database functions enforce access. Record writes and their activity events commit together. No secret/service-role key is needed in the app. Fresh installations contain no dummy records, and there is no demo or local database fallback.

This is an early release, not an independently audited product. Read [SECURITY.md](SECURITY.md) for the threat model and [DEPLOYMENT.md](DEPLOYMENT.md) for backups, account recovery and the mandatory installation acceptance checks. Previous local databases stay local and are not automatically migrated.

## Development

Use Node.js 24 or newer.

```sh
npm ci
cp .env.example .env.local
# Set the two public Supabase build variables for a development project.
npm run dev
```

Open `http://localhost:5173`. To build and preview, run `npm run build` and `npm start`.

```sh
npm test
npm run build
npm audit
```

Database integration checks run separately with `npm run test:database` against an empty local PostgreSQL database. See [CONTRIBUTING.md](CONTRIBUTING.md). The test Auth schema simulates verified identities; a real provider acceptance test is still required after deployment.

## Repository

- `src/` — React dashboard, authentication and Supabase repository layer
- `src/components/ui/` — shadcn/ui components
- `supabase/migrations/` — deployable schema, RLS policies and database functions
- `supabase/tests/` — disposable PostgreSQL authorization tests, never production migrations
- `.env.example`, `vercel.json` — deployment configuration
- `data/` — ignored legacy local files, never published or bundled

Design uses shadcn/ui, Tailwind CSS and Geist, with layout guidance from [OpsLoop](https://opsloop-dashboard.vercel.app/) and the [ShadcnStore dashboard](https://shadcnstore.com/templates/dashboard/shadcn-dashboard-landing-template/dashboard). No proprietary template source is included.

[MIT license](LICENSE) · [Contributing](CONTRIBUTING.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)
