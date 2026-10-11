# Contributing

1. Fork the repository and create a focused branch. Use Node 24 or newer.
2. Run `npm ci`, copy `.env.example` to `.env.local`, and configure a separate development Supabase project. Run the migration once and create confirmed test accounts.
3. Run `npm run dev`. Use fictional data only. Never commit credentials, private exports or runtime databases.
4. Preserve workspace isolation and the existing shadcn/ui design. Check mobile, dark mode, keyboard navigation and empty/error states.
5. Run `npm test`, `npm run build` and the PostgreSQL checks for database changes.
6. Open a PR explaining behavior and verification. Security reports belong in the private reporting channel in SECURITY.md.

## PostgreSQL authorization tests

Install PostgreSQL 17 or newer and put `psql` on PATH. Use a **new, empty, local database named `casetrack_test`** with a test administrator account. The script refuses other names/hosts and refuses databases containing an Auth schema or CaseTrack tables. Never point this harness at Supabase or valuable data.

```sh
createdb casetrack_test
TEST_DATABASE_URL=postgresql://YOUR_LOCAL_USER@127.0.0.1:5432/casetrack_test npm run test:database
```

PowerShell: set `$env:TEST_DATABASE_URL` before running the npm command. PostgreSQL must already be running and reachable on the supplied port. Credentials are passed to `psql` via its environment, not logged by the script. The test database retains the schema after the run; recreate only this disposable database before rerunning. CI supplies a disposable PostgreSQL service.

The bootstrap simulates Supabase's `auth.users`, `auth.uid()`, `anon` and `authenticated` roles. Tests execute the exact production migration and assert actual PostgreSQL grants, policies, triggers and constraints. They do not validate hosted Auth, API configuration or email/password provisioning; those require a separate staging project and the deployment acceptance checks.
