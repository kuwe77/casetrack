import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
test("first run is locked, and an encrypted workspace survives restart", async (t) => {
  const f = fixture(t);
  assert.equal(f.store.initialized(), false);
  assert.throws(() => f.store.read(), /locked/);
  await f.store.setup({
    name: "Local firm",
    password: "Test-only passphrase for vault",
  });
  f.reopen();
  await assert.rejects(
    f.store.unlock("Wrong passphrase provided"),
    /Incorrect/,
  );
  await f.store.unlock("Test-only passphrase for vault");
  assert.equal(f.store.read().firm.name, "Local firm");
  assert.deepEqual(f.store.read().cases, []);
  await assert.rejects(
    f.store.setup({
      name: "Overwrite",
      password: "Test-only passphrase for vault",
    }),
    /already exists/,
  );
});
test("case progress, agent edits, follow-ups and notes survive restart", async (t) => {
  const f = fixture(t);
  await f.store.setup({
    name: "Sample firm",
    sample: true,
    password: "Test-only passphrase for vault",
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
  await f.store.unlock("Test-only passphrase for vault");
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
    password: "Test-only passphrase for vault",
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
