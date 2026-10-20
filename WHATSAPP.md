# WhatsApp Business integration

CaseTrack connects through Zernio or directly to the Meta WhatsApp Cloud API. Hosting, encrypted credentials, messages, scheduled jobs and firm data live in Cloudflare. WhatsApp itself is Meta's service and cannot be replaced by Cloudflare storage.

## Zernio setup and inbox

In the firm's WhatsApp page, select **Zernio**, enter the Zernio account ID and API key, and save. The server verifies that the key owns an active WhatsApp account. The key is encrypted and is never returned to the browser or external agents. Each connected Zernio account can belong to only one CaseTrack firm.

The connected inbox lists conversations and loads messages with explicit pagination. Refresh retrieves new messages and delivery/read statuses without sending read receipts. Retrieved messages are reconciled into the firm message log. The optional reply assistant adds its own account-scoped webhook subscription without replacing unrelated registrations.

## Muse reply assistant

Meta Muse is the external reasoning agent. CaseTrack does not host an LLM. See [the Muse setup guide](public/muse/SETUP.md) and [standard-library poller](public/muse/casetrack.py).

The owner enables agent replies, connects the signed Zernio webhook and creates an `assistant:reply` key. This scope cannot be combined with any other scope and requires an owner to mint it. Incoming messages qualify only for the current connected account, verified phone and consented registered agent, after enabling, within 23 hours. Unknown/hidden senders, standby events, synthetic test events and non-text messages do not create AI jobs. STOP opts out immediately.

The hook polls every 30 seconds without AI or provider calls. On a new eligible job it claims and persists it before returning `wake`. One active claim per firm; ten-minute renewable leases; three processing attempts maximum; at most five questions from the same sender/conversation. Muse must start an isolated conversation for each job, with no personal memory or unrelated tools.

Job context projects only assigned case references, type, status, target date and explicitly shared update. The server never returns private parties, property, values, notes or documents. Context revisions and a final SQL compare-and-set reject drafts after case/consent/account changes. AI output is still model-generated: scope restrictions constrain available data, while topic adherence and avoiding fabricated answers require the documented isolated-worker instructions.

For replies, resolve the signed webhook's exact conversation ID through the account-scoped Zernio detail endpoint and verify its participant phone. Webhook internal IDs and inbox/search platform IDs can differ for the same conversation; raw ID equality across those sources is not a sender check. Consent/history checks and dispatch use the resolved ID. Missing, foreign-account or different-recipient conversations fail closed without a phone-search fallback.

Replies have a fixed recipient and idempotency key. Repeated identical submissions return their existing outcome. Ambiguous sends are held for human review, never automatically retried; an interrupted dispatch stops blocking other senders after two minutes. Signed delivery receipts reconcile even when they arrive before the send response; receipt lookup records expire after 30 days, while message/job history remains. The owner sees recent questions, status and a daily reply cap (default 100, maximum 300, UTC reset).

Switching accounts or disabling messaging pauses the assistant and cancels waiting work. The existing Preview only setting applies. No automatic template outreach is used. Deploy migration `0007_reply_assistant.sql` before the Pages worker and scheduler. No Muse-side hook is enabled by a website deployment; complete the guide on the Muse VM.

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
