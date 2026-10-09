# Security policy and threat model

CaseTrack v0.1 is a local, single-user application. Security controls are implemented and covered by automated tests, but this is not an independently audited or certified product. Do not expose its HTTP server to a network or use the development server as a public service.

## Intended protections

- **Stolen database or backup:** all workspace content is encrypted with AES-256-GCM. Every write uses a fresh 96-bit nonce and a 128-bit authentication tag; a versioned associated-data string binds the payload to this format. SQLite schema, salt, approximate data size and file timestamps are visible.
- **Passphrase guessing:** scrypt derives a 256-bit key using a random 256-bit salt and N=131072, r=8, p=1. The minimum passphrase length is 14 characters. Strong, unique passphrases are essential; offline guessing is still possible if a database is stolen. Online unlock attempts have exponential backoff, capped at 60 seconds, and only one derivation runs at once. Restarting the server resets online backoff.
- **Locked workspace:** the server holds the derived key only while unlocked. Lock, idle expiry and process shutdown invalidate the session and overwrite the held key buffer. JavaScript strings, garbage collection, OS swap and process dumps prevent a guarantee that all plaintext memory has been erased.
- **Browser sessions:** 256-bit random tokens are stored as hashes in server memory. Cookies are HttpOnly, SameSite=Strict and scoped to `/api`. The local HTTP cookie is not marked Secure because the supported transport is loopback HTTP. No credentials or case records are stored in localStorage. Only one session is active; unlocking replaces the previous one.
- **Untrusted websites:** strict Host and Origin checks, a required custom API header, Fetch Metadata checks and no CORS grants protect the local API against cross-site access and DNS rebinding. The production server binds only to IPv4 loopback.
- **Input and rendering:** server-side Zod validation, body-size limits, prepared statements, workspace/reference checks, React text escaping and CSV formula escaping. Case updates and activity events commit atomically.
- **Browser hardening:** production CSP restricts script, font and network sources to self, blocks framing and plugins, and disables camera/microphone/geolocation. Inline styles remain enabled for UI components. Responses use `Cache-Control: no-store`.
- **File access:** newly created data directories use mode 0700 and database/journal files use 0600 on POSIX. Windows relies on the user's directory ACLs; keep the data directory in a private user location. Runtime database files, environment files and logs are ignored by Git.

## Limits and operational responsibilities

This does not protect against malware, a compromised dependency, a hostile browser extension, keyloggers, another process with the same OS privileges, an administrator, or someone viewing an unlocked session. The loopback channel does not use TLS. Keep the operating system and browser updated and use full-disk encryption. Do not run untrusted browser extensions with access to localhost.

While unlocked, record data exists in application and browser memory. The server expires after 15 minutes without a data request; the UI clears on its next status check (up to 30 seconds later), on focus, or on an unauthorized API response. Use Lock before leaving the device. A locked browser may retain data in browser-managed history/memory; this app cannot securely erase a browser or OS.

GCM detects modified ciphertext but cannot detect substitution of an older valid backup. The activity log is an application history, not an independently tamper-proof audit system. There is no multi-user authorization, remote access, password rotation, encrypted export UI or recovery mechanism in this version. Single-document encryption is suitable for modest workspaces and rewrites the document on updates.

CSV exports contain plaintext. Backups must include the whole data directory with the app stopped. Passphrase loss is permanent. Application encryption does not replace your organization's access, retention, backup or legal requirements.

## Report a vulnerability

Use GitHub's private vulnerability reporting for this repository when available. Never post case records, passphrases, cookies or database files in a public issue. If private reporting is unavailable, open a minimal issue requesting a private contact without exploit details or personal information.

A useful report identifies the affected version, reproduction using fictional data, expected boundary, observed result and potential impact. Maintainers will triage reports on a best-effort basis; no response-time guarantee is offered.
