# WhatsApp Business integration

CaseTrack connects through Zernio or directly to the Meta WhatsApp Cloud API. Hosting, encrypted credentials, messages, scheduled jobs and firm data live in Cloudflare. WhatsApp itself is Meta's service and cannot be replaced by Cloudflare storage.

## Zernio setup and inbox

In the firm's WhatsApp page, select **Zernio**, enter the Zernio account ID and API key, and save. The server verifies that the key owns an active WhatsApp account. The key is encrypted and is never returned to the browser or external agents. Each connected Zernio account can belong to only one CaseTrack firm.

The connected inbox lists conversations and loads messages with explicit pagination. Refresh retrieves new messages and delivery/read statuses without sending read receipts. Retrieved messages are reconciled into the firm message log. Existing Zernio/Hermes automations and webhook registrations are not changed. This implementation polls on request; it does not claim instant push delivery.

External agents use `whatsapp:read` for `/whatsapp/connection`, `/whatsapp/contacts`, `/whatsapp/conversations`, `/whatsapp/conversations/{id}/messages`, the local `/whatsapp/messages` log, and rules. Follow every `nextCursor` until null; IDs and cursors are opaque. This exposes the history available from the connected provider, including incoming/outgoing messages and attachment links. The server pins the firm's account ID and rejects data belonging to a different provider account.

Sends use the same `/whatsapp/messages` endpoint for either provider. CaseTrack reconciles recipient opt-outs before Zernio sends and requires a recent incoming message for free-text replies. An approved template is required outside the reply window. Switching provider/account disables existing schedules so the owner can review them before re-enabling.

## Direct Meta setup

1. Add the firm's property agents and verify their international phone numbers.
2. Obtain a Meta WhatsApp Business phone number ID, an access token with the required messaging permission, and the Meta app secret.
3. In WhatsApp, save the credentials, enable messaging and keep **Preview only** enabled initially. Saved credentials are encrypted and are never returned by the settings API.
4. Copy the callback URL and one-time verification token into the Meta app. Subscribe to `messages`. Incoming requests must have a valid `X-Hub-Signature-256`; the business phone number must match the firm's settings.
5. Save each approved recipient with verified number and messaging consent. STOP, CANCEL and UNSUBSCRIBE revoke consent.
6. Review a preview before turning off preview mode. Live messaging requires Meta approval/configuration and may incur provider fees.

## Sends and schedules

A free-text reply needs an inbound message within 23 hours (a conservative margin within Meta's reply window). Outside that window use an approved template through the API. Scheduled updates always use a Meta-approved template with **one body parameter**. That parameter contains only case reference, stage, target date and the explicitly shared update. Private notes, parties and property details are excluded.

The scheduler claims due work atomically, skips completed/on-hold cases and unapproved recipients, and checks up to ten due updates every five minutes. High volume may require tuning or queues. Missed runs resume on a later tick; no exact-time delivery guarantee is made.

Every send requires an `Idempotency-Key`. New manual keys must not start with the reserved `schedule:` prefix; existing same-key retries remain supported. Retry using the same key and payload. `accepted` means the provider accepted the request; delivery/read status comes from signed Meta callbacks or authenticated Zernio message retrieval. `uncertain` means a timeout or ambiguous response: check the provider before attempting a new send. The system never automatically retries uncertain sends.

Resetting a rule to an already processed timestamp does not resend that occurrence. Duplicate occurrences and individual rule failures cannot abort other selected rules or the shared expiry cleanup. The ten-rule selection remains a shared capacity limit, not a per-firm delivery guarantee.

API keys with `whatsapp:read` can read their firm's messages and rules. `whatsapp:write` can send to approved recipients and update rules. Provider credentials and recipient consent remain owner-controlled in the app. An external AI agent can combine WhatsApp scopes with case/task/note scopes to operate its own workflows. CaseTrack does not execute arbitrary agent code or infer changes from untrusted inbound messages.
