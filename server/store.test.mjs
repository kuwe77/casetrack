import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./store.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "casetrack-test-"));
  let store = openStore(join(dir, "test.sqlite"));
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = openStore(join(dir, "test.sqlite"));
      return store;
    },
  };
}
test("workspace-name-only setup opens automatically after restart", async (t) => {
  const f = fixture(t);
  assert.equal(f.store.initialized(), false);
  assert.equal(f.store.read(), null);
  await f.store.setup({
    name: "Local firm",
  });
  f.reopen();
  assert.equal(f.store.read().firm.name, "Local firm");
  assert.deepEqual(f.store.read().cases, []);
  await assert.rejects(
    f.store.setup({
      name: "Overwrite",
    }),
    /already exists/,
  );
});
test("case progress, agent edits, follow-ups and notes survive restart", async (t) => {
  const f = fixture(t);
  await f.store.setup({
    name: "Sample firm",
    sample: true,
  });
  const w = f.store.read(),
    c = w.cases[0],
    task = w.tasks[0];
  f.store.mutate("cases", {
    ...c,
    status: "completed",
    next_step: "Keys released",
  });
  f.store.mutate("agents", { ...w.agents[0], name: "Updated agent" });
  f.store.mutate("tasks", { ...task, completed: true });
  f.store.mutate("notes", {
    firm_id: w.firm.id,
    case_id: c.id,
    note: "Completion verified",
  });
  f.reopen();
  const saved = f.store.read();
  assert.equal(saved.cases.find((x) => x.id === c.id).status, "completed");
  assert.equal(saved.agents[0].name, "Updated agent");
  assert.equal(saved.tasks.find((x) => x.id === task.id).completed, true);
  assert.equal(saved.activities[0].detail, "Completion verified");
  assert(saved.activities.some((x) => x.title === "Moved to Completed"));
});
test("invalid writes roll back without corrupting records or audit history", async (t) => {
  const { store } = fixture(t);
  await store.setup({
    name: "Validation firm",
    sample: true,
  });
  const w = store.read();
  assert.throws(
    () =>
      store.mutate("cases", {
        ...w.cases[1],
        ref: w.cases[0].ref.toLowerCase(),
      }),
    /already exists/,
  );
  assert.throws(() => store.mutate("cases", { ...w.cases[0], value: -10 }));
  assert.throws(() =>
    store.mutate("cases", { ...w.cases[0], status: "invalid" }),
  );
  assert.throws(
    () =>
      store.mutate("cases", { ...w.cases[0], firm_id: crypto.randomUUID() }),
    /does not match/,
  );
  assert.throws(
    () =>
      store.mutate("cases", { ...w.cases[0], agent_id: crypto.randomUUID() }),
    /does not exist/,
  );
  assert.throws(
    () =>
      store.mutate("notes", {
        firm_id: w.firm.id,
        case_id: crypto.randomUUID(),
        note: "Unknown case",
      }),
    /does not exist/,
  );
  assert.deepEqual(store.read(), w);
});

test("missing or replaced local keys fail closed and preserve records", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "casetrack-key-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "test.sqlite"),
    keyPath = join(dir, "workspace.key");
  const store = openStore(path);
  await store.setup({ name: "Key recovery test" });
  store.close();
  const key = readFileSync(keyPath);
  assert.equal(key.length, 32);
  rmSync(keyPath);
  assert.throws(() => openStore(path), /no local key/);
  assert.equal(existsSync(keyPath), false);
  writeFileSync(keyPath, Buffer.alloc(32));
  assert.throws(() => openStore(path));
  writeFileSync(keyPath, key);
  const restored = openStore(path);
  try {
    assert.equal(restored.read().firm.name, "Key recovery test");
  } finally {
    restored.close();
  }
});
