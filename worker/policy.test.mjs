import test from "node:test";
import assert from "node:assert/strict";
import {
  phone,
  inbound,
  decision,
  reply,
  followup,
  prompt,
} from "./policy.mjs";
const own = {
  id: "case-a",
  ref: "A-001",
  status: "loan",
  due_date: "2026-12-01",
  shared_update: "Waiting for the bank.",
};
const ctx = { consent: true, cases: [own] };
const c = {
  id: "conversation",
  accountId: "a",
  platform: "whatsapp",
  participantId: "60123456789",
};
const now = Date.parse("2026-10-11T12:00:00Z");
const m = {
  id: "m1",
  conversationId: "conversation",
  accountId: "a",
  platform: "whatsapp",
  senderId: "60123456789",
  direction: "incoming",
  message: "status A-001",
  createdAt: "2026-10-11T11:00:00Z",
};
test("numbers match exact international format without guessing a country", () => {
  assert.equal(phone("6012 345-6789"), "+60123456789");
  assert.equal(phone("0123456789"), null);
  assert.equal(phone("agent@group"), null);
  assert.equal(phone("+60123456789 ext 1"), null);
});
test("only authentic same-account incoming direct messages are eligible", () => {
  assert.ok(inbound(c, m, "a", "2026-10-11", now));
  for (const change of [
    { accountId: "b" },
    { senderId: "60999999999" },
    { direction: "outgoing" },
    { isDeleted: true },
    { isEdited: true },
    { createdAt: "2020-01-01" },
    { conversationId: "other" },
  ])
    assert.equal(inbound(c, { ...m, ...change }, "a", "2026-10-11", now), null);
  assert.equal(
    inbound({ ...c, isGroup: true }, m, "a", "2026-10-11", now),
    null,
  );
});
test("model cannot add arbitrary text, execute tools or change recipient", () => {
  const d = decision({
    intent: "status",
    language: "en",
    refs: ["A-001"],
    response: "HACK",
    phone: "other",
  });
  assert.equal(d.phone, undefined);
  assert.equal(d.response, undefined);
  assert.throws(() =>
    decision({ intent: "execute", language: "en", refs: [] }),
  );
});
test("other case denied without confirming existence", () => {
  const r = reply(
    { intent: "status", language: "en", refs: ["B-SECRET"] },
    ctx,
  );
  assert.match(r, /only share/);
  assert.ok(!r.includes("B-SECRET"));
  assert.ok(!r.includes("A-001"));
});
test("mixed own and foreign case inquiry fails closed", () =>
  assert.match(
    reply(
      { intent: "status", language: "en", refs: ["A-001", "B-SECRET"] },
      ctx,
    ),
    /only share/,
  ));
test("no case information for unregistered numbers", () =>
  assert.match(
    reply({ intent: "status", language: "en", refs: ["A-001"] }, null),
    /only share/,
  ));
test("private fields never appear in progress response or model prompt", () => {
  const rich = {
    cases: [
      { ...own, buyer: "SECRET BUYER", notes: "SECRET NOTE", value: 123456 },
    ],
  };
  const r = reply({ intent: "status", language: "en", refs: ["A-001"] }, rich);
  assert.ok(r.includes("Loan documentation"));
  assert.ok(!/SECRET|123456/.test(r));
  assert.ok(
    !/SECRET|123456|Waiting for the bank/.test(
      JSON.stringify(prompt("progress", rich)),
    ),
  );
});
test("followups require consent, current assignment and active case", () => {
  const rule = { case_id: "case-a", enabled: true, mode: "request_update" };
  assert.ok(followup(rule, ctx));
  assert.equal(followup(rule, { ...ctx, consent: false }), null);
  assert.equal(followup(rule, { ...ctx, cases: [] }), null);
  assert.equal(
    followup(rule, { ...ctx, cases: [{ ...own, status: "completed" }] }),
    null,
  );
  assert.equal(followup({ ...rule, enabled: false }, ctx), null);
});
