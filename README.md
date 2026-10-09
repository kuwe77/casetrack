# CaseTrack

**A private, local-first workspace for conveyancing cases.**

CaseTrack is open-source case management for a single user on their own computer. Manage cases, property-agent contacts, milestones, follow-ups, internal notes and activity history in a shadcn/ui dashboard. Includes light and dark themes, search, a case board and CSV export.

![CaseTrack dashboard](docs/dashboard.jpg)

## Install locally

Install [Node.js 24 LTS](https://nodejs.org/) or newer and Git. These commands work in macOS Terminal, Windows PowerShell and Linux shells:

```sh
git clone https://github.com/kuwe77/casetrack.git
cd casetrack
npm ci
npm run build
npm start
```

Open **http://localhost:4173**. On first launch, choose a workspace name and a unique passphrase of at least 14 characters. You can optionally load fictional sample cases. Keep your passphrase in a password manager: there is no reset, recovery key or service that can decrypt your records for you.

Later, run `npm start` from the same folder. Stop with Ctrl+C. No cloud account, external database, deployment, API key or environment file is required. Installation downloads dependencies; everyday operation works offline. Fonts are bundled, with no analytics or remote scripts.

> CaseTrack v0.1 is an early release. Review the [security model and limitations](SECURITY.md) before using it for confidential records. It is a local single-user application, not a shared office server.

## What you can do

- Open and update cases, assign a property agent and person in charge, and track deadlines and property value.
- Move cases through document collection, SPA, loan documentation, redemption, stamping, disbursement and completion.
- View cases in a searchable, filterable table or board.
- Create, complete and reopen follow-ups.
- Record internal notes and view the activity log.
- Manage property-agent contacts and firm details.
- Export cases to CSV and switch between light and dark mode.

“Agents” means property-agent contacts. There is no AI bot, chat assistant or automated agent.

## Data and security

The server listens only on `127.0.0.1`. Case records are stored as an AES-256-GCM encrypted workspace payload inside `data/casetrack.sqlite`, including activity and contact details. A key is derived from your passphrase using scrypt; neither the passphrase nor the encryption key is saved to disk. The SQLite file and journals contain encrypted record data, not plaintext cases.

The workspace starts locked after a restart. An authenticated browser session is required to read or change data. Lock it from the sidebar or Settings. The server also locks after 15 minutes without an authenticated data request; the browser checks session status every 30 seconds and on focus. The session check itself does not extend the timeout. Unlocking in a second browser invalidates the previous session.

Records are not stored in browser localStorage; only the light/dark preference is. CSV exports are **unencrypted**. Keep them somewhere appropriate. Encryption does not protect data while displayed or against malware, a compromised OS/browser, or someone using your unlocked computer.

### Back up and restore

1. Stop CaseTrack with Ctrl+C so SQLite can close cleanly.
2. Copy the **entire `data` folder** to your backup destination. Do not commit it to Git or attach it to an issue.
3. Keep the passphrase separately in your password manager.
4. To restore, stop CaseTrack, preserve your current data folder as a backup, copy the saved data folder into the project, then run `npm start` and unlock using its original passphrase.

The app has no passphrase-change or forgotten-passphrase recovery feature yet. If the passphrase is lost, the records cannot be recovered. Keep multiple encrypted backup copies. Full-disk encryption (FileVault, BitLocker or equivalent) provides additional protection for exports, swap and other system files.

By default, data lives beside the source. For a custom directory or port, set `CASETRACK_DATA_DIR` or `PORT` in your shell before `npm start`. The listening interface remains loopback-only. Use one server process per data directory. There is no supported LAN, reverse-proxy, Docker or public-hosting mode.

## Development

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. This starts Vite and the local API together; it uses the same data directory unless you set `CASETRACK_DATA_DIR`. For routine use, use the production build with `npm start` instead of the development server.

```sh
npm test
npm run build
npm audit
```

Tests cover business dates, overdue rules, CSV escaping, encrypted persistence, passphrase rejection, tamper detection, session expiry, request-origin checks and local file permissions. CI runs on Node 24 on Linux, macOS and Windows.

### Structure

- `src/` — React + TypeScript dashboard, shared models and fictional sample data
- `src/components/ui/` — shadcn/ui primitives, owned in the repository
- `server/` — loopback HTTP API, validation, encrypted SQLite store and security tests
- `scripts/dev.mjs` — cross-platform development launcher
- `data/` — runtime database, excluded from Git

SQLite stores one encrypted workspace document, updated inside a transaction together with the activity event. This is deliberately scoped to a modest single-user workload; there is no multi-user conflict resolution. Case workflows currently use Malaysian conveyancing stages, MYR and Asia/Kuala_Lumpur business dates.

## Design and licensing

The interface uses [shadcn/ui](https://ui.shadcn.com/) components, Tailwind CSS and Geist. The [ShadcnStore dashboard](https://shadcnstore.com/templates/dashboard/shadcn-dashboard-landing-template/dashboard) informed the layout; no proprietary template source or artwork is included.

CaseTrack is [MIT licensed](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
