import { fail } from "./security";

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown) => typeof value === "string" ? value : "";
const digits = (value: string) => value.replace(/\D/g, "");
export class ZernioError extends Error {
  constructor(public status: number) { super(`WhatsApp provider request failed (${status}).`); }
}
export interface Conversation {
  id: string; accountId: string; participantId: string; participantName: string;
  lastMessage: string; updatedTime: string; unreadCount: number; status: string;
}
export interface InboxMessage {
  id: string; body: string; direction: string; created_at: string; status: string;
  attachments: { type: string; url: string; name: string }[];
}
function page(data: Row) {
  const pagination = object(data.pagination);
  if (pagination.hasMore && !str(pagination.nextCursor)) fail(503, "WhatsApp pagination is incomplete. Try again later.");
  return { nextCursor: pagination.hasMore ? str(pagination.nextCursor) : null };
}
export class ZernioClient {
  // Workers' global fetch must not receive the client instance as its `this` value.
  constructor(private key: string, readonly accountId: string, private fetcher: typeof fetch = (input, init) => fetch(input, init)) {}
  async request(path: string, query: Record<string,string> = {}, body?: unknown, idempotencyKey?: string): Promise<Row> {
    const params = new URLSearchParams({ ...query, accountId: this.accountId });
    const response = await this.fetcher(`https://zernio.com/api/v1${path}?${params}`, {
      method: body ? "POST" : "GET", redirect: "manual", signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
      ...(body ? { body: JSON.stringify({ ...object(body), accountId: this.accountId }) } : {}),
    });
    if (!response.ok) throw new ZernioError(response.status);
    const data = object(await response.json());
    if (Number(object(data.meta).accountsFailed || 0) > 0) throw new ZernioError(503);
    return data;
  }
  async verify() {
    const data = await this.request("/accounts", { platform: "whatsapp" });
    const accounts = data.accounts || data.data;
    if (!Array.isArray(accounts)) fail(503, "Unexpected WhatsApp account response.");
    const account = accounts.map(object).find(a => (a._id || a.id) === this.accountId);
    if (!account || account.platform !== "whatsapp" || account.isActive !== true) fail(400, "Choose an active WhatsApp account belonging to this Zernio key.");
    return { label: str(account.displayName), phone: str(account.username) };
  }
  private conversation(value: unknown): Conversation {
    const c = object(value);
    // Even a provider API regression must not return another connected account's data.
    if (c.accountId !== this.accountId || c.platform !== "whatsapp") fail(404, "Conversation not found in this firm's WhatsApp account.");
    if (!str(c.id)) fail(503, "Unexpected WhatsApp conversation response.");
    return { id: str(c.id), accountId: this.accountId, participantId: str(c.participantId || c.participantUsername),
      participantName: str(c.participantName), lastMessage: str(c.lastMessage),
      updatedTime: str(c.updatedTime || c.lastMessageAt), unreadCount: Number(c.unreadCount || 0), status: str(c.status) };
  }
  async conversations(cursor = "", limit = 50) {
    const result = await this.request("/inbox/conversations", { platform:"whatsapp", sortOrder:"desc", limit:String(limit), ...(cursor ? {cursor} : {}) });
    if (!Array.isArray(result.data)) fail(503, "Unexpected WhatsApp inbox response.");
    return { data: result.data.map(c => this.conversation(c)), ...page(result) };
  }
  async getConversation(id: string) {
    const result = await this.request(`/inbox/conversations/${encodeURIComponent(id)}`);
    return this.conversation(result.data);
  }
  async messages(id: string, cursor = "", limit = 50) {
    const conversation = await this.getConversation(id);
    const result = await this.request(`/inbox/conversations/${encodeURIComponent(id)}/messages`, {
      sortOrder:"desc", limit:String(limit), ...(cursor ? {cursor} : {}),
    });
    if (!Array.isArray(result.messages)) fail(503, "Unexpected WhatsApp message response.");
    const data: InboxMessage[] = result.messages.map(value => {
      const m = object(value);
      if (m.accountId !== this.accountId || m.platform !== "whatsapp") fail(404, "Message not found in this firm's WhatsApp account.");
      if (!str(m.id) || !["incoming","outgoing"].includes(str(m.direction))) fail(503, "Unexpected WhatsApp message identity.");
      return { id: str(m.id), body: str(m.message), direction: str(m.direction), created_at: str(m.createdAt),
        status: str(m.deliveryStatus) || (m.direction === "incoming" ? "received" : "accepted"),
        attachments: (Array.isArray(m.attachments) ? m.attachments : []).map(object).map(a => ({
          type:str(a.type), url: /^https:\/\//i.test(str(a.url)) ? str(a.url) : "", name:str(a.name || a.filename),
        })) };
    });
    return { conversation, data, ...page(result) };
  }
  async findPhone(phone: string) {
    let cursor = "";
    const seen = new Set<string>();
    for (let n = 0; n < 10; n++) {
      const result = await this.request("/inbox/conversations/search", {
        platform:"whatsapp", query:digits(phone), limit:"50", ...(cursor ? {cursor} : {}),
      });
      if (!Array.isArray(result.data)) fail(503, "Unexpected WhatsApp search response.");
      for (const item of result.data) {
        const c = object(object(item).conversation);
        if (c.accountId !== this.accountId || c.platform !== "whatsapp") fail(404, "Conversation not found in this firm's WhatsApp account.");
        if (digits(str(c.participantId || c.participantUsername)) !== digits(phone)) continue;
        const full = await this.getConversation(str(c.id));
        if (digits(full.participantId) === digits(phone)) return full;
      }
      const next = page(result).nextCursor;
      if (!next) return null;
      if (seen.has(next)) fail(503, "WhatsApp pagination did not advance.");
      seen.add(next); cursor = next;
    }
    fail(503, "WhatsApp search is incomplete. Try again later.");
  }
  async send(phone: string, body: string, key: string, template?: { name:string; language:string; parameters:string[] }, conversationId?: string) {
    const result = template
      ? await this.request("/inbox/conversations", {}, {participantId:digits(phone),templateName:template.name,templateLanguage:template.language,templateParams:template.parameters}, key)
      : await this.request(`/inbox/conversations/${encodeURIComponent(conversationId || "")}/messages`, {}, {message:body,linkPreview:false}, key);
    const data = object(result.data);
    if (result.success !== true || !str(data.messageId)) throw new ZernioError(502);
    return { providerId:str(data.messageId), conversationId:str(data.conversationId) || conversationId || "" };
  }
}
