import { phone, inbound, reply, followup } from "./policy.mjs";
export async function cycle({
  api,
  rpc,
  interpret,
  accountId,
  now = () => Date.now(),
}) {
  await api.verify();
  const state = await rpc("poll");
  if (state.account_id !== accountId)
    throw Error("Dashboard account does not match pinned worker account");
  if (!state.enabled) return state.poll_seconds;
  const conversations = (await api.conversations()).filter(
    (c) =>
      c.platform === "whatsapp" &&
      c.accountId === accountId &&
      !c.contactBlocked &&
      !c.isGroup &&
      !String(c.id).includes("@g.us"),
  );
  const histories = new Map();
  const history = async (c) => {
    if (!histories.has(c.id)) histories.set(c.id, await api.messages(c.id));
    return histories.get(c.id);
  };
  const call = (operation, payload = {}) =>
    rpc(operation, { account_id: accountId, ...payload });
  async function process({ key, p, kind, caseId, c, rule, text }) {
    const claimed = await call("claim", {
      event_key: key,
      phone: p,
      kind,
      case_id: caseId,
    });
    if (!claimed) return;
    let sending = false;
    const finish = (status, reason, response = "") =>
      rpc("finish", { id: claimed.id, status, reason, response });
    try {
      const context = await call("context", { phone: p });
      if (!context)
        return await finish(
          "blocked",
          "Number is unregistered, disabled, or no longer matches agent",
        );
      const d = kind === "reply" ? await interpret(text, context) : null;
      // Always re-read authorization and facts after model inference, just before constructing the send.
      const authorization = await call("authorize", {
        phone: p,
        id: claimed.id,
      });
      if (!authorization?.context)
        return await finish("blocked", "Access revoked or integration paused");
      const freshRule = authorization.rule;
      const response =
        kind === "reply"
          ? reply(d, authorization.context)
          : followup(freshRule, authorization.context);
      if (!response)
        return await finish(
          "blocked",
          "Case assignment or follow-up rule changed",
        );
      const messages = c ? await history(c) : [];
      const inWindow = messages.some(
        (m) =>
          m.direction === "incoming" &&
          m.accountId === accountId &&
          m.conversationId === c.id &&
          phone(m.senderId) === p &&
          Number.isFinite(Date.parse(m.createdAt)) &&
          Date.parse(m.createdAt) <= now() &&
          now() - Date.parse(m.createdAt) < 23 * 3600000,
      );
      if (kind === "reply" && !inWindow)
        return await finish("blocked", "WhatsApp reply window closed");
      if (!inWindow && !freshRule?.template_name)
        return await finish(
          "blocked",
          "Approved template required outside reply window",
        );
      if (authorization.dry_run)
        return await finish(
          "preview",
          inWindow ? "Preview only" : "Preview: approved template required",
          response,
        );
      sending = true;
      if (inWindow) await api.send(c.id, response, claimed.id);
      else await api.template(p, freshRule, response, claimed.id);
      await finish(
        "sent",
        "Accepted by Zernio; delivery not yet confirmed",
        response,
      );
    } catch {
      // A timeout after POST may have delivered. Do not blindly retry or claim delivery.
      await finish(
        sending ? "uncertain" : "failed",
        sending
          ? "Check Zernio before any manual resend"
          : "Processing failed; check worker configuration",
      );
    }
  }
  for (const c of conversations) {
    const p = phone(c.participantId);
    if (!p) continue;
    // Fetch only potentially relevant conversations; provider timestamps are an optimization, never authorization.
    if (
      Number.isFinite(Date.parse(c.updatedTime)) &&
      Date.parse(c.updatedTime) < Date.parse(state.enabled_since)
    )
      continue;
    const messages = await history(c);
    for (const m of [...messages].reverse()) {
      const event = inbound(c, m, accountId, state.enabled_since, now());
      if (!event) continue;
      if (/^(stop|unsubscribe|berhenti|henti)$/i.test(event.text.trim())) {
        await call("optout", { phone: p, event_key: event.key });
        continue;
      }
      if (state.auto_reply)
        await process({
          key: event.key,
          p,
          kind: "reply",
          c,
          text: event.text,
        });
    }
  }
  for (const rule of state.rules || []) {
    const p = phone(rule.phone);
    if (!p) continue;
    const c = conversations.find((c) => phone(c.participantId) === p);
    await process({
      key: `followup:${rule.case_id}:${rule.next_due_at}`,
      p,
      kind: "followup",
      caseId: rule.case_id,
      c,
      rule,
    });
  }
  return state.poll_seconds;
}
