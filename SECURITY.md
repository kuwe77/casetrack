# Security policy and threat model

CaseTrack v0.1 is a local, single-user application. Security controls are implemented and covered by automated tests, but this is not an independently audited or certified product. Do not expose its HTTP server to a network or use the development server as a public service.

## Intended protections

- **Database copied without its key:** workspace content is encrypted with AES-256-GCM using a random 256-bit key saved in `data/workspace.key`. Every write uses a fresh 96-bit nonce and 128-bit authentication tag with versioned associated data. Schema, approximate size and timestamps remain visible. A copy of both the database and key can be decrypted.
- **Automatic local access:** there is no passphrase, authentication, lock or session timeout. The workspace opens automatically. Anyone able to reach the running loopback server can use the API; custom headers are browser-origin protection, not credentials. OS account controls and disk encryption must protect the machine and backups.
- **Key preservation:** a populated database with a missing, invalid or mismatched key fails closed. It is not reset. Earlier passphrase-protected databases require their original application version and passphrase; automatic migration is not supported.
- **Untrusted websites:** strict Host and Origin checks, a required custom API header, Fetch Metadata checks and no CORS grants protect the local API against cross-site access and DNS rebinding. The production server binds only to IPv4 loopback.
- **Input and rendering:** server-side Zod validation, body-size limits, prepared statements, workspace/reference checks, React text escaping and CSV formula escaping. Case updates and activity events commit atomically.
- **Browser hardening:** production CSP restricts script, font and network sources to self, blocks framing and plugins, and disables camera/microphone/geolocation. Inline styles remain enabled for UI components. Responses use `Cache-Control: no-store`.
- **File access:** newly created data directories use mode 0700 and database/journal/key files use 0600 on POSIX. Windows relies on the user's directory ACLs; keep the data directory in a private user location. Runtime database files, keys, environment files and logs are ignored by Git.

## Limits and operational responsibilities

This does not protect against malware, a compromised dependency, a hostile browser extension, keyloggers, another process with the same OS privileges, an administrator, or someone viewing an unlocked session. The loopback channel does not use TLS. Keep the operating system and browser updated and use full-disk encryption. Do not run untrusted browser extensions with access to localhost.

Record data exists in application and browser memory while running. Closing the server overwrites the held key buffer, but JavaScript garbage collection, swap and process dumps prevent guaranteed erasure. Lock the OS account before leaving the device. CaseTrack cannot securely erase browser or OS memory.

GCM detects modified ciphertext but cannot detect substitution of an older valid backup. The activity log is an application history, not an independently tamper-proof audit system. There is no multi-user authorization, remote access, key rotation, encrypted export UI or recovery mechanism in this version. Single-document encryption is suitable for modest workspaces and rewrites the document on updates.

CSV exports contain plaintext. Backups must include the whole data directory with the app stopped. Backups contain the decryption key and need separate protection. Key loss is permanent. Application encryption does not replace your organization's access, retention, backup or legal requirements.

## Report a vulnerability

Use GitHub's private vulnerability reporting for this repository when available. Never post case records, keys or database files in a public issue. If private reporting is unavailable, open a minimal issue requesting a private contact without exploit details or personal information.

A useful report identifies the affected version, reproduction using fictional data, expected boundary, observed result and potential impact. Maintainers will triage reports on a best-effort basis; no response-time guarantee is offered.
