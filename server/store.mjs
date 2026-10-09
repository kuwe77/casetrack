import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import { deriveKey, encrypt, decrypt } from "./crypto.mjs";
import { makeSeed } from "../src/lib/seed.ts";
import { stages } from "../src/lib/model.ts";

const text = z.string().max(10000);
const name = z.string().trim().min(1).max(150);
const id = z.uuid();
const date = z.union([z.literal(""), z.iso.date()]);
const timestamp = z.iso.datetime({ offset: true });
const base = { id, firm_id: id, created_at: timestamp };
const priority = z.enum(["normal", "high"]);
const schemas = {
  cases: z.object({
    ...base,
    ref: name,
    buyer: name,
    seller: text,
    property: text,
    type: z.enum(["Subsale", "SPA", "Loan", "Refinance"]),
    status: z.enum(stages.map((s) => s.id)),
    priority,
    agent_id: id.nullable(),
    owner: text,
    due_date: date,
    next_step: text,
    notes: text,
    value: z.number().finite().nonnegative(),
    updated_at: timestamp,
  }),
  agents: z.object({
    ...base,
    name,
    email: text,
    phone: text,
    agency: text,
    color: z.enum([
      "lime",
      "blue",
      "peach",
      "lavender",
      "green",
      "rose",
      "teal",
      "amber",
      "violet",
    ]),
  }),
  tasks: z.object({
    ...base,
    case_id: id.nullable(),
    title: name,
    due_date: date,
    assignee: text,
    completed: z.boolean(),
    priority,
  }),
  firm: z.object({ id, name, email: text }),
  notes: z.object({
    firm_id: id,
    case_id: id,
    note: z.string().trim().min(1).max(10000),
  }),
};
export function openStore(path) {
  process.umask(0o077);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (
    db.prepare("SELECT name FROM sqlite_master WHERE name='workspace'").get()
  ) {
    db.close();
    throw Error(
      "Legacy unencrypted database detected. Move it aside before creating an encrypted workspace.",
    );
  }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS vault (id INTEGER PRIMARY KEY CHECK(id=1), salt BLOB NOT NULL, data TEXT NOT NULL);`);
  if (process.platform !== "win32")
    for (const file of [path, path + "-wal", path + "-shm"])
      if (existsSync(file)) chmodSync(file, 0o600);
  let key = null;
  const row = () => db.prepare("SELECT salt, data FROM vault WHERE id=1").get();
  const initialized = () => Boolean(row());
  const lock = () => {
    key?.fill(0);
    key = null;
  };
  const read = () => {
    if (!key) throw Error("Workspace is locked.");
    const saved = row();
    return saved ? decrypt(saved.data, key) : null;
  };
  const write = (data) => {
    if (!key) throw Error("Workspace is locked.");
    db.prepare("UPDATE vault SET data=? WHERE id=1").run(encrypt(data, key));
  };
  const event = (w, case_id, title, detail, kind) =>
    w.activities.unshift({
      id: randomUUID(),
      firm_id: w.firm.id,
      case_id,
      title,
      detail,
      kind,
      actor: "You",
      created_at: new Date().toISOString(),
    });
  return {
    read,
    initialized,
    lock,
    close: () => {
      lock();
      db.close();
    },
    async setup(input) {
      const payload = z
        .object({
          name,
          sample: z.boolean().default(false),
          password: z.string().min(14).max(1024),
        })
        .parse(input);
      if (initialized()) throw Error("A workspace already exists.");
      const salt = randomBytes(32),
        candidate = await deriveKey(payload.password, salt);
      try {
        const w = payload.sample
          ? makeSeed()
          : {
              firm: { id: randomUUID(), name: payload.name, email: "" },
              cases: [],
              agents: [],
              tasks: [],
              activities: [],
            };
        w.firm.name = payload.name;
        db.prepare("INSERT INTO vault VALUES(1, ?, ?)").run(
          salt,
          encrypt(w, candidate),
        );
        lock();
        key = candidate;
      } catch (e) {
        candidate.fill(0);
        throw e;
      }
    },
    async unlock(password) {
      const saved = row();
      if (!saved) throw Error("Create a workspace first.");
      const candidate = await deriveKey(password, saved.salt);
      try {
        decrypt(saved.data, candidate);
      } catch {
        candidate.fill(0);
        throw Error("Incorrect passphrase or damaged database.");
      }
      lock();
      key = candidate;
    },
    mutate(route, input) {
      db.exec("BEGIN IMMEDIATE");
      try {
        let w = read();
        {
          if (!w) throw Error("Create a workspace first.");
          if (!schemas[route]) throw Error("Unknown operation.");
          const record = schemas[route].parse(input);
          if ((route === "firm" ? record.id : record.firm_id) !== w.firm.id)
            throw Error("Workspace does not match.");
          if (record.case_id && !w.cases.some((c) => c.id === record.case_id))
            throw Error("Case does not exist.");
          if (
            record.agent_id &&
            !w.agents.some((a) => a.id === record.agent_id)
          )
            throw Error("Agent does not exist.");
          if (route === "firm") w.firm = record;
          else if (route === "notes")
            event(
              w,
              record.case_id,
              "Internal note added",
              record.note,
              "note",
            );
          else {
            const old = w[route].find((x) => x.id === record.id);
            if (route === "cases") {
              if (
                w.cases.some(
                  (c) =>
                    c.id !== record.id &&
                    c.ref.toLowerCase() === record.ref.toLowerCase(),
                )
              )
                throw Error(
                  "This case reference already exists. Use a unique reference.",
                );
              record.updated_at = new Date().toISOString();
              const changed = old && old.status !== record.status;
              event(
                w,
                record.id,
                !old
                  ? "New case opened"
                  : changed
                    ? `Moved to ${stages.find((s) => s.id === record.status).full}`
                    : "Case details updated",
                record.next_step,
                changed ? "status" : "case",
              );
            } else if (route === "agents")
              event(
                w,
                null,
                old ? "Agent details updated" : "Agent added",
                record.name,
                "agent",
              );
            else
              event(
                w,
                record.case_id,
                record.completed
                  ? "Follow-up completed"
                  : old
                    ? "Follow-up updated"
                    : "Follow-up created",
                record.title,
                "task",
              );
            w[route] = [record, ...w[route].filter((x) => x.id !== record.id)];
          }
        }
        write(w);
        db.exec("COMMIT");
        return { ok: true };
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
