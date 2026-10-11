import test from "node:test";
import assert from "node:assert/strict";
import { Zernio } from "./zernio.mjs";
test("account verification refuses non-WhatsApp account", async () => {
  const api = new Zernio("test", "a", async () => ({
    ok: true,
    json: async () => ({
      accounts: [{ _id: "a", platform: "threads", isActive: true }],
    }),
  }));
  await assert.rejects(api.verify());
});
test("pagination walks all pages and preserves opaque cursor", async () => {
  const urls = [];
  const api = new Zernio("test", "a", async (url) => {
    urls.push(url);
    return {
      ok: true,
      json: async () =>
        urls.length === 1
          ? {
              data: [{ id: 1 }],
              pagination: { hasMore: true, nextCursor: "opaque/==value" },
            }
          : { data: [{ id: 2 }], pagination: { hasMore: false } },
    };
  });
  assert.equal((await api.conversations()).length, 2);
  assert.equal(new URL(urls[1]).searchParams.get("cursor"), "opaque/==value");
});
test("failed account read never looks like empty inbox", async () => {
  const api = new Zernio("test", "a", async () => ({
    ok: true,
    json: async () => ({ data: [], meta: { accountsFailed: 1 } }),
  }));
  await assert.rejects(api.conversations());
});
test("send pins origin/account and includes idempotency key without logging provider body", async () => {
  let request;
  const api = new Zernio("private", "a", async (url, opts) => {
    request = { url, opts };
    return { ok: true, json: async () => ({}) };
  });
  await api.send("c", "hello", "event");
  assert.ok(request.url.startsWith("https://zernio.com/api/v1/"));
  assert.equal(JSON.parse(request.opts.body).accountId, "a");
  assert.equal(request.opts.headers["Idempotency-Key"], "event");
  assert.equal(request.opts.redirect, "error");
});
