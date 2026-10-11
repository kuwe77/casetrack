import test from "node:test";
import assert from "node:assert/strict";
import { cycle } from "./engine.mjs";
const now = Date.parse("2026-10-11T12:00:00Z");
function harness(options = {}) {
  const state = {
    account_id: "a",
    enabled: true,
    dry_run: false,
    auto_reply: true,
    poll_seconds: 60,
    enabled_since: "2026-10-11T00:00:00Z",
    rules: [],
  };
  const c = {
    id: "c",
    accountId: "a",
    platform: "whatsapp",
    participantId: "60123456789",
  };
  const m = {
    id: "m",
    conversationId: "c",
    accountId: "a",
    platform: "whatsapp",
    senderId: "60123456789",
    direction: "incoming",
    message: "A-001 progress",
    createdAt: "2026-10-11T11:00:00Z",
  };
  const ctx = {
    phone: "+60123456789",
    consent: true,
    cases: [{ id: "a", ref: "A-001", status: "loan" }],
  };
  const seen = new Set(),
    results = [],
    sent = [],
    calls = [];
  const rpc = async (op, p = {}) => {
    calls.push(op);
    if (op === "poll") return { ...state, ...options.state };
    if (op === "context") return options.unknown ? null : ctx;
    if (op === "claim") {
      if (seen.has(p.event_key)) return null;
      seen.add(p.event_key);
      return { id: "event" };
    }
    if (op === "authorize")
      return options.revoked
        ? null
        : {
            dry_run: !!options.preview,
            context: {
              ...ctx,
              cases: options.reassigned
                ? []
                : [{ ...ctx.cases[0], status: "stamping" }],
            },
            rule: options.rule,
          };
    if (op === "finish") {
      results.push(p);
      return {};
    }
    if (op === "optout") return {};
  };
  const api = {
    verify: async () => {},
    conversations: async () => [c],
    messages: async () => [{ ...m, ...options.message }],
    send: async (...args) => {
      sent.push(args);
      if (options.timeout) throw Error("timeout");
    },
    template: async (...args) => sent.push(args),
  };
  const interpret = async () => {
    if (options.modelFail) throw Error();
    return { intent: "status", language: "en", refs: ["A-001"] };
  };
  return {
    args: { api, rpc, interpret, accountId: "a", now: () => now },
    results,
    sent,
    calls,
  };
}
test("repeated polls never send duplicate incoming message", async () => {
  const h = harness();
  await cycle(h.args);
  await cycle(h.args);
  assert.equal(h.sent.length, 1);
});
test("fresh data after model inference wins", async () => {
  const h = harness();
  await cycle(h.args);
  assert.match(h.sent[0][1], /Stamping/);
  assert.ok(!h.sent[0][1].includes("Loan"));
});
test("revocation during model inference blocks send", async () => {
  const h = harness({ revoked: true });
  await cycle(h.args);
  assert.equal(h.sent.length, 0);
  assert.equal(h.results[0].status, "blocked");
});
test("case reassignment during model inference does not disclose old facts", async () => {
  const h = harness({ reassigned: true });
  await cycle(h.args);
  assert.match(h.sent[0][1], /only share/);
  assert.ok(!h.sent[0][1].includes("A-001"));
});
test("unknown numbers never reach model or send", async () => {
  const h = harness({ unknown: true });
  h.args.interpret = () => assert.fail("model called");
  await cycle(h.args);
  assert.equal(h.sent.length, 0);
});
test("preview mode records content without sending", async () => {
  const h = harness({ preview: true });
  await cycle(h.args);
  assert.equal(h.sent.length, 0);
  assert.equal(h.results[0].status, "preview");
});
test("uncertain send is not retried", async () => {
  const h = harness({ timeout: true });
  await cycle(h.args);
  await cycle(h.args);
  assert.equal(h.sent.length, 1);
  assert.equal(h.results[0].status, "uncertain");
});
test("model outage fails closed", async () => {
  const h = harness({ modelFail: true });
  await cycle(h.args);
  assert.equal(h.sent.length, 0);
  assert.equal(h.results[0].status, "failed");
});
test("wrong pinned account stops processing", async () => {
  const h = harness({ state: { account_id: "other" } });
  await assert.rejects(cycle(h.args), /does not match/);
  assert.equal(h.sent.length, 0);
});
test("STOP disables phone without model call or reply", async () => {
  const h = harness({ message: { message: "STOP" } });
  await cycle(h.args);
  assert.ok(h.calls.includes("optout"));
  assert.equal(h.sent.length, 0);
});
test("paused integration does not scan inbox", async () => {
  const h = harness({ state: { enabled: false } });
  h.args.api.conversations = () => assert.fail();
  await cycle(h.args);
});
test("scheduled progress uses fresh facts and an approved template outside the window", async () => {
  const rule = {
    case_id: "a",
    phone: "+60123456789",
    enabled: true,
    mode: "send_progress",
    next_due_at: "2026-10-11T10:00:00Z",
    template_name: "case_update",
    template_language: "en_US",
  };
  const h = harness({
    state: { auto_reply: false, rules: [rule] },
    rule,
    message: { createdAt: "2026-10-09T10:00:00Z" },
  });
  await cycle(h.args);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0][0], "+60123456789");
  assert.equal(h.sent[0][1].template_name, "case_update");
  assert.match(h.sent[0][2], /Stamping/);
});
test("scheduled follow-up with closed window and no template is blocked", async () => {
  const rule = {
    case_id: "a",
    phone: "+60123456789",
    enabled: true,
    mode: "request_update",
    next_due_at: "2026-10-11T10:00:00Z",
    template_name: "",
  };
  const h = harness({
    state: { auto_reply: false, rules: [rule] },
    rule,
    message: { createdAt: "2026-10-09T10:00:00Z" },
  });
  await cycle(h.args);
  assert.equal(h.sent.length, 0);
  assert.equal(h.results[0].status, "blocked");
});
