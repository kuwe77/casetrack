import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
export function credentials(env = process.env) {
  let key = env.ZERNIO_API_KEY;
  if (!key) {
    const path = join(homedir(), ".zernio/config.json");
    if (process.platform !== "win32" && statSync(path).mode & 0o077)
      throw Error(
        "Run chmod 600 ~/.zernio/config.json before starting the worker",
      );
    try {
      key = JSON.parse(readFileSync(path, "utf8")).apiKey;
    } catch {
      throw Error(
        "Could not read Zernio CLI configuration. Run zernio auth:login again.",
      );
    }
  }
  if (!key || /[\r\n]/.test(key))
    throw Error("Log in using zernio auth:login first");
  // Pin the official API origin: never forward a saved credential to an arbitrary override.
  return key;
}
export class Zernio {
  constructor(key, accountId, fetcher = fetch) {
    this.key = key;
    this.accountId = accountId;
    this.fetcher = fetcher;
  }
  async request(path, { body, idempotencyKey } = {}) {
    const r = await this.fetcher(`https://zernio.com/api/v1${path}`, {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!r.ok) throw Error(`Zernio HTTP ${r.status}`); // Never log provider bodies, keys, or inbox contents.
    return r.json();
  }
  async verify() {
    const d = await this.request("/accounts");
    const accounts = d.accounts || d.data || [];
    const a = accounts.find((a) => a._id === this.accountId);
    if (!a || a.platform !== "whatsapp" || a.isActive !== true)
      throw Error(
        "Pinned account is not an active WhatsApp account for this key",
      );
    return {
      id: a._id,
      platform: a.platform,
      last4: String(a.username).replace(/\D/g, "").slice(-4),
    };
  }
  async pages(path, field) {
    const items = [];
    let cursor;
    const seen = new Set();
    for (let page = 0; page < 100; page++) {
      const q = new URLSearchParams({
        accountId: this.accountId,
        limit: "100",
        sortOrder: "desc",
        ...(cursor ? { cursor } : {}),
      });
      const d = await this.request(`${path}?${q}`);
      if (d.meta?.accountsFailed) throw Error("Zernio account read failed");
      if (!Array.isArray(d[field])) throw Error("Unexpected Zernio response");
      items.push(...d[field]);
      if (!d.pagination?.hasMore) return items;
      cursor = d.pagination.nextCursor;
      if (!cursor || seen.has(cursor))
        throw Error("Zernio pagination did not advance");
      seen.add(cursor);
    }
    throw Error("Inbox exceeds safe scan limit; no partial scan is sent");
  }
  conversations() {
    return this.pages("/inbox/conversations", "data");
  }
  messages(id) {
    return this.pages(
      `/inbox/conversations/${encodeURIComponent(id)}/messages`,
      "messages",
    );
  }
  async send(id, text, key) {
    return this.request(
      `/inbox/conversations/${encodeURIComponent(id)}/messages`,
      {
        body: { accountId: this.accountId, message: text, linkPreview: false },
        idempotencyKey: key,
      },
    );
  }
  async template(phone, rule, text, key) {
    return this.request("/inbox/conversations", {
      body: {
        accountId: this.accountId,
        participantId: phone.replace(/^\+/, ""),
        templateName: rule.template_name,
        templateLanguage: rule.template_language,
        templateParams: [text],
      },
      idempotencyKey: key,
    });
  }
}
