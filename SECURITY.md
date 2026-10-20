# Security model

- Better Auth manages email/password sessions with native scrypt hashing, HttpOnly cookies, session expiration and login/signup rate limits. Passwords require 12–128 characters. Email ownership verification is not configured; an account's email is not evidence of professional identity.
- Workspace membership and firm IDs are checked server-side on every protected request. Foreign keys prevent cross-firm relationships. IDs are never authorization.
- API keys have random 256-bit secrets stored only as SHA-256 hashes, explicit scopes, expiration and revocation. Keys cannot manage account recovery, membership or provider credentials. Removing a member invalidates their keys immediately.
- Recovery codes are random, hashed and single-use. Recovery changes the password and revokes sessions and API keys in an atomic database batch. Store the code offline; without it or the password, there is no automatic email-reset path.
- Cookie-authenticated writes require the trusted origin. Bearer clients use HTTPS; no CORS access is enabled. Body and upload sizes are bounded. Request throttling uses D1 counters.
- R2 is private. Downloads require an authorized firm session or documents:read key and are served as attachments without caching.
- Meta credentials and Zernio API keys are encrypted with AES-GCM using AUTH_SECRET-derived key material. Webhooks verify HMAC signatures and business number. Recipient consent, case assignment, preview mode and idempotency protect sends. Zernio requests pin the owner-verified account on the server and reject mismatched conversation/message accounts. Inbox pagination is explicit; no provider secrets are returned. Zernio opt-outs are reconciled during reads and before sending.
- Audit records cover record writes, notes, uploads, keys and schedule changes. They are not an independent tamper-proof compliance ledger; account administrators control the underlying Cloudflare resources.

This is not a certification of legal, privacy or industry compliance. Operators must establish their privacy policy, retention, access reviews, incident response and backup practices for their jurisdiction and clientele. Do not post vulnerabilities or credentials in public issues; contact the repository owner privately.
