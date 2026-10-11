# Deploy CaseTrack with Vercel + Supabase

Each installation uses its own Vercel project and Supabase project. The app has no shared vendor backend, bot, paid API, or SMTP dependency. Accounts use email/password and are provisioned by the deployment administrator. Do not use the old local-only build on the internet.

## 1. Create and prepare Supabase

1. Create a **new** project at [Supabase](https://supabase.com/dashboard). Choose the appropriate region for your records. Save the database password privately; CaseTrack does not need it in the browser or Vercel.
2. Open SQL Editor. Paste and run the whole [initial migration](supabase/migrations/202610110001_workspace.sql) **once**. It creates the tables, row-level policies, owner/member permissions and audit triggers. It inserts no sample data. Do not run `supabase/tests/*` in your project.
3. In Authentication → Sign In / Providers, enable **Email/password**, disable **Allow new users to sign up**, and keep **Confirm email** enabled. Provision confirmed users as described below. Disable anonymous sign-ins and unused providers. Configure a strong minimum password length (at least 12) in the Email provider settings.
4. In the project's Connect dialog, copy the **Project URL** and **publishable key** (`sb_publishable_…`). Do not use an `sb_secret_…` key, legacy `service_role` key, or database password.

The SQL file expects an empty CaseTrack schema. If it fails, the transaction rolls back; fix the reported cause before retrying. Do not drop existing production tables to make it run. Future migrations must be applied in filename order with a backup first.

## 2. Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fkuwe77%2Fcasetrack&env=VITE_SUPABASE_URL,VITE_SUPABASE_PUBLISHABLE_KEY&envDescription=Use%20the%20Project%20URL%20and%20publishable%20key%20from%20your%20Supabase%20Connect%20dialog.&envLink=https%3A%2F%2Fgithub.com%2Fkuwe77%2Fcasetrack%2Fblob%2Fmain%2FDEPLOYMENT.md&project-name=casetrack&repository-name=casetrack)

The button creates your own repository/project and asks for these two values:

| Variable                        | Value                                  |
| ------------------------------- | -------------------------------------- |
| `VITE_SUPABASE_URL`             | `https://YOUR_PROJECT_REF.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Your `sb_publishable_…` key            |

Alternatively, fork the repository and import it in Vercel with the **Vite** preset. Build: `npm run build`. Output: `dist`. Use Node 24 or newer. The included `vercel.json` supplies routing and security headers. Vercel serves the frontend; the browser calls Supabase's authenticated API and database functions. No always-running Node server is required.

These two values are public browser configuration, **not private credentials**. Row-level security is the authorization boundary. Never add a service-role or secret key to a `VITE_` variable. Changes to these variables require a new build/deployment. Missing or invalid configuration shows a setup screen, never a local/demo fallback.

After deployment, set the Supabase Auth **Site URL** to the Vercel production URL. Password sign-in does not need an email callback. Leave redirect allowlists narrow; do not add broad preview wildcards. For isolated staging, use a separate Supabase project rather than pointing previews at production data.

## 3. Create your first account and workspace

1. In Supabase Authentication → Users, use **Add user → Create new user**, not “Send invitation”. Enter an email and a strong password, and enable **Auto Confirm User**. This creates a verified account without sending email. Provision only people whose identity/email you have verified yourself.
2. Open your deployed CaseTrack URL and sign in with that account.
3. Choose a workspace name. You become its owner. New workspaces are empty.
4. Change your password in Settings → Your account password after receiving a temporary password.

Do not disable confirmation and open public signup as a shortcut. CaseTrack deliberately has no public registration, email-code login or email password-reset workflow, so no SMTP account is required.

## 4. Add colleagues

1. The **deployment administrator** creates a confirmed Supabase account for the colleague (same steps as above). Send their initial password through your usual secure channel.
2. The **workspace owner** opens CaseTrack → Settings → Workspace members and invites that exact email.
3. Share the deployment URL. The colleague signs in and chooses **Join workspace** on their invitation. Do not create a separate workspace first.

Invitations last 7 days. They are access grants stored in the database; **no invitation email is sent automatically**. Reinviting renews the expiry. Owners can revoke pending invitations and remove members. Removal blocks subsequent database access immediately, even with an existing login session. The UI refreshes on focus and every minute; already viewed/downloaded information cannot be recalled.

Each account belongs to one workspace. Members share access to all cases, contacts, follow-ups and notes in that workspace. Only owners edit firm details or manage membership. There is no ownership-transfer or workspace-deletion UI in this version.

## Password recovery without SMTP

A signed-in user can change their password in Settings. If a user is locked out, the deployment administrator can use the official [Supabase Admin `updateUserById`](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid) API from a trusted local/server environment to set a replacement password. It requires a Supabase secret key and the user's ID from Authentication → Users. Do not execute admin code in the browser, put its key in Vercel frontend variables, or delete/recreate the account: membership belongs to the original user ID.

For a supported helper, create a private, ignored `.env.admin.local` file in your checkout with `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (an `sb_secret_…` key), and `NEW_PASSWORD` (at least 12 characters). Then run:

```sh
node --env-file=.env.admin.local scripts/reset-password.mjs AUTH_USER_UUID
```

Use the existing user's UUID from Supabase Authentication → Users. This changes that account's password; it never creates a new identity. The helper does not print passwords or keys. Delete the temporary credentials file afterward and deliver the replacement password privately. This is an administrator-only local command, not part of the deployed app.

## 5. Verify your installation

- Sign out: records disappear and the sign-in screen is shown.
- Create a case, edit its milestone, create/complete a follow-up, add a note, refresh, and verify persistence.
- Invite a test colleague, join, and confirm both accounts see the same workspace.
- Create a second test owner/workspace: it must not see the first workspace's records.
- Remove the colleague and confirm they can no longer read or change the first workspace.
- Confirm all seven public app tables have RLS enabled in Supabase. Check the Security Advisor.
- Configure and test your backup/restore procedure before storing confidential records. Available managed backup features depend on your Supabase plan; exports from CaseTrack are CSV case lists, not full backups.

The repository's PostgreSQL tests verify the SQL authorization rules using simulated Auth identities. They do not replace this acceptance check against your actual Supabase Auth, Data API and Vercel deployment.

## Local development

```sh
npm ci
cp .env.example .env.local
# Fill in your development Supabase project URL and publishable key.
npm run dev
```

Open `http://localhost:5173`. On Windows, copy `.env.example` to `.env.local` using Explorer or `Copy-Item`. For a local production preview, run `npm run build` then `npm start` and open `http://localhost:4173`. Both modes require Supabase; there is no automatic SQLite fallback.

## Existing local installations

This release does not upload or import the previous SQLite database. Preserve the entire old `data` folder, including `workspace.key`, privately. Use the previous local release at commit `2d070db` in a separate checkout to access it. Cloud workspaces start empty. CSV export preserves a case list only; automatic full-workspace migration is not provided. Never upload database files, keys or client exports to GitHub.

## Troubleshooting

- **Connect your Supabase project:** set both build variables, use the publishable key format, then redeploy.
- **Database setup is missing:** run the initial migration in the same project as the configured URL.
- **Invalid login credentials / Email not confirmed:** verify the account was created with a password and Auto Confirm User. Ask your deployment administrator; there is no public signup or email recovery flow.
- **No invitation:** check the account email, expiry, and project URL. An account already in a workspace cannot accept a second workspace invitation.
- **Changes fail after removal:** this is expected; only current members may access records.

References: [Supabase React Auth](https://supabase.com/docs/guides/auth/quickstarts/react), [password authentication](https://supabase.com/docs/guides/auth/passwords), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Vercel Deploy Button](https://vercel.com/docs/deploy-button).
