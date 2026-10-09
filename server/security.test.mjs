import { test } from "node:test";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt } from "./crypto.mjs";
import { createLocalServer } from "./index.mjs";

async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "casetrack-http-"));
  const server = createLocalServer({ dataDir: dir, ...options });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (route, data, headers = {}) =>
    fetch(origin + "/api/" + route, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        "X-CaseTrack-Client": "local",
        "Content-Type": "application/json",
        Origin: origin,
        ...headers,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  const setup = async () => {
    const res = await request("setup", {
      name: "Private firm sentinel 84291",
      sample: true,
      password: "Test-only secure passphrase 84291",
    });
    assert.equal(res.status, 200);
    return res.headers.get("set-cookie").split(";")[0];
  };
  return { dir, origin, request, setup };
}
test("unauthenticated, cross-site and rebinding requests cannot read records", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("workspace")).status, 401);
  const cookie = await f.setup();
  assert.equal(
    (await f.request("workspace", undefined, { Cookie: cookie })).status,
    200,
  );
  assert.equal(
    (
      await f.request("workspace", undefined, {
        Cookie: cookie,
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  const hostileHost = await new Promise((resolve, reject) => {
    const req = httpRequest(
      f.origin + "/api/workspace",
      {
        headers: {
          Host: "evil.example",
          "X-CaseTrack-Client": "local",
          Cookie: cookie,
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(hostileHost, 403);
  assert.equal(
    (
      await f.request("workspace", undefined, {
        Cookie: cookie,
        "Sec-Fetch-Site": "cross-site",
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(f.origin + "/api/workspace", { headers: { Cookie: cookie } }))
      .status,
    403,
  );
  assert.equal(
    (
      await f.request("setup", {
        name: "overwrite",
        password: "Test-only secure passphrase 84291",
      })
    ).status,
    409,
  );
  const page = await fetch(f.origin);
  assert.match(
    page.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal(page.headers.get("cache-control"), "no-store");
});
test("lock invalidates cookies; wrong passwords are rejected and throttled", async (t) => {
  const f = await fixture(t),
    cookie = await f.setup();
  assert.equal((await f.request("lock", {}, { Cookie: cookie })).status, 200);
  assert.equal(
    (await f.request("workspace", undefined, { Cookie: cookie })).status,
    401,
  );
  assert.equal(
    (await f.request("unlock", { password: "Wrong passphrase for testing" }))
      .status,
    400,
  );
  assert.equal(
    (
      await f.request("unlock", {
        password: "Test-only secure passphrase 84291",
      })
    ).status,
    429,
  );
});
test("session expiry locks the vault without requiring another page request", async (t) => {
  const f = await fixture(t, { idleMs: 60 }),
    cookie = await f.setup();
  await new Promise((r) => setTimeout(r, 100));
  const res = await f.request("session", undefined, { Cookie: cookie });
  assert.deepEqual(await res.json(), {
    initialized: true,
    authenticated: false,
  });
  assert.equal(
    (await f.request("workspace", undefined, { Cookie: cookie })).status,
    401,
  );
});
test("database and journals contain ciphertext, not names or passphrases", async (t) => {
  const f = await fixture(t);
  await f.setup();
  for (const name of readdirSync(f.dir)) {
    const path = join(f.dir, name),
      data = readFileSync(path);
    assert.equal(
      data.includes(Buffer.from("Private firm sentinel 84291")),
      false,
    );
    assert.equal(data.includes(Buffer.from("Ahmad")), false);
    assert.equal(
      data.includes(Buffer.from("Test-only secure passphrase")),
      false,
    );
    if (process.platform !== "win32")
      assert.equal(statSync(path).mode & 0o077, 0);
  }
});
test("authenticated encryption rejects modification and uses fresh nonces", () => {
  const key = randomBytes(32),
    value = { note: "Private case details" };
  const a = encrypt(value, key),
    b = encrypt(value, key);
  assert.notEqual(a, b);
  assert.deepEqual(decrypt(a, key), value);
  const changed = JSON.parse(a),
    ciphertext = Buffer.from(changed.ciphertext, "base64");
  ciphertext[0] ^= 1;
  changed.ciphertext = ciphertext.toString("base64");
  assert.throws(() => decrypt(JSON.stringify(changed), key));
  assert.throws(() => decrypt(a, randomBytes(32)));
});
