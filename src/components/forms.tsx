import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { SpinnerGap } from "@phosphor-icons/react";
import { Modal } from "./ui";
import type { Workspace, CaseRecord, Agent, FollowUp } from "../lib/model";
import { today, stages, dayOffset } from "../lib/model";
import { errorMessage } from "../lib/repository";
function Field({
  label,
  children,
  full = false,
}: {
  label: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`field ${full ? "field-full" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
function str(f: FormData, key: string) {
  return String(f.get(key) || "").trim();
}
export function Editor({
  kind,
  existing,
  workspace,
  onClose,
  onSave,
}: {
  kind: "case" | "agent" | "task";
  existing?: CaseRecord | Agent | FollowUp;
  workspace: Workspace;
  onClose: () => void;
  onSave: (
    kind: "case" | "agent" | "task",
    record: CaseRecord | Agent | FollowUp,
  ) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const c = kind === "case" ? (existing as CaseRecord | undefined) : undefined,
    a = kind === "agent" ? (existing as Agent | undefined) : undefined,
    t = kind === "task" ? (existing as FollowUp | undefined) : undefined;
  const now = new Date().toISOString();
  const nextRef = () => {
    let n = 1041;
    while (
      workspace.cases.some((x) => x.ref === `CT-${today().slice(0, 4)}-${n}`)
    )
      n++;
    return `CT-${today().slice(0, 4)}-${n}`;
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const base = {
      id: existing?.id || crypto.randomUUID(),
      firm_id: workspace.firm.id,
      created_at: existing?.created_at || now,
    };
    try {
      let record: CaseRecord | Agent | FollowUp;
      if (kind === "case") {
        record = {
          ...base,
          ref: str(f, "ref"),
          buyer: str(f, "buyer"),
          seller: str(f, "seller"),
          property: str(f, "property"),
          type: str(f, "type") as CaseRecord["type"],
          status: str(f, "status") as CaseRecord["status"],
          priority: str(f, "priority") as CaseRecord["priority"],
          agent_id: str(f, "agent_id") || null,
          owner: str(f, "owner"),
          due_date: str(f, "due_date"),
          next_step: str(f, "next_step"),
          notes: str(f, "notes"),
          value: Number(f.get("value") || 0),
          updated_at: now,
        };
        if (!record.ref || !record.buyer || !record.property || !record.owner)
          throw Error(
            "Complete the reference, buyer, property and person in charge.",
          );
      } else if (kind === "agent") {
        record = {
          ...base,
          name: str(f, "name"),
          agency: str(f, "agency"),
          email: str(f, "email"),
          phone: str(f, "phone"),
          color:
            a?.color ||
            ["teal", "blue", "amber", "violet"][workspace.agents.length % 4],
        };
        if (!record.name) throw Error("Enter the agent’s name.");
      } else {
        record = {
          ...base,
          title: str(f, "title"),
          case_id: str(f, "case_id") || null,
          assignee: str(f, "assignee"),
          due_date: str(f, "due_date"),
          priority: str(f, "priority") as FollowUp["priority"],
          completed: t?.completed || false,
        };
        if (!record.title || !record.assignee)
          throw Error("Enter a title and person responsible.");
      }
      await onSave(kind, record);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={`${existing ? "Edit" : "New"} ${kind === "task" ? "follow-up" : kind}`}
      description={
        kind === "case"
          ? "Give every matter a clear owner and a next step."
          : kind === "agent"
            ? "Keep your property agent contacts in one place."
            : "A small next step that keeps the case moving."
      }
      wide={kind === "case"}
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          {kind === "case" && (
            <>
              <Field label="Case reference">
                <Input
                  name="ref"
                  defaultValue={c?.ref || nextRef()}
                  required
                  maxLength={60}
                />
              </Field>
              <Field label="Case type">
                <select name="type" defaultValue={c?.type || "Subsale"}>
                  {["Subsale", "SPA", "Loan", "Refinance"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="Buyer / client">
                <Input
                  name="buyer"
                  defaultValue={c?.buyer}
                  placeholder="Full name or company"
                  required
                  maxLength={200}
                />
              </Field>
              <Field label="Seller">
                <Input
                  name="seller"
                  defaultValue={c?.seller}
                  placeholder="Name or company"
                  maxLength={200}
                />
              </Field>
              <Field label="Property address" full>
                <Input
                  name="property"
                  defaultValue={c?.property}
                  placeholder="Address, development or unit number"
                  required
                  maxLength={400}
                />
              </Field>
              <Field label="Current milestone">
                <select name="status" defaultValue={c?.status || "documents"}>
                  {stages.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.full}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <select name="priority" defaultValue={c?.priority || "normal"}>
                  <option value="normal">Normal</option>
                  <option value="high">High priority</option>
                </select>
              </Field>
              <Field label="Assigned agent">
                <select name="agent_id" defaultValue={c?.agent_id || ""}>
                  <option value="">Unassigned</option>
                  {workspace.agents.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Person in charge">
                <Input
                  name="owner"
                  defaultValue={c?.owner}
                  placeholder="Staff member’s name"
                  required
                  maxLength={120}
                />
              </Field>
              <Field label="Target completion">
                <Input
                  name="due_date"
                  type="date"
                  defaultValue={c?.due_date || dayOffset(30)}
                  required
                />
              </Field>
              <Field label="Property value (RM)">
                <Input
                  name="value"
                  type="number"
                  min="0"
                  max="999999999999"
                  step="0.01"
                  defaultValue={c?.value || ""}
                  placeholder="0"
                />
              </Field>
              <Field label="Next step" full>
                <Input
                  name="next_step"
                  defaultValue={c?.next_step}
                  placeholder="What needs to happen next?"
                  required
                  maxLength={500}
                />
              </Field>
              <Field label="Internal case notes" full>
                <Textarea
                  name="notes"
                  defaultValue={c?.notes}
                  placeholder="Context for your team"
                  rows={3}
                  maxLength={5000}
                />
              </Field>
            </>
          )}
          {kind === "agent" && (
            <>
              <Field label="Full name" full>
                <Input
                  name="name"
                  defaultValue={a?.name}
                  required
                  maxLength={200}
                />
              </Field>
              <Field label="Agency" full>
                <Input
                  name="agency"
                  defaultValue={a?.agency}
                  placeholder="Real estate agency"
                  maxLength={200}
                />
              </Field>
              <Field label="Email">
                <Input
                  name="email"
                  type="email"
                  defaultValue={a?.email}
                  maxLength={254}
                />
              </Field>
              <Field label="Phone">
                <Input
                  name="phone"
                  type="tel"
                  defaultValue={a?.phone}
                  placeholder="+60"
                  maxLength={40}
                />
              </Field>
            </>
          )}
          {kind === "task" && (
            <>
              <Field label="Follow-up" full>
                <Input
                  name="title"
                  defaultValue={t?.title}
                  placeholder="e.g. Request the redemption statement"
                  required
                  maxLength={300}
                />
              </Field>
              <Field label="Related case" full>
                <select name="case_id" defaultValue={t?.case_id || ""}>
                  <option value="">General follow-up</option>
                  {workspace.cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.ref} · {c.buyer}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Assigned to">
                <Input
                  name="assignee"
                  defaultValue={t?.assignee}
                  placeholder="Staff member’s name"
                  required
                  maxLength={120}
                />
              </Field>
              <Field label="Due date">
                <Input
                  name="due_date"
                  type="date"
                  defaultValue={t?.due_date || today()}
                  required
                />
              </Field>
              <Field label="Priority">
                <select name="priority" defaultValue={t?.priority || "normal"}>
                  <option value="normal">Normal</option>
                  <option value="high">High priority</option>
                </select>
              </Field>
            </>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-footer">
          <Button
            variant="ghost"
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="ghost"
            className="button button-primary"
            disabled={busy}
          >
            {busy ? <SpinnerGap className="spin" size={18} /> : null}
            {busy
              ? "Saving…"
              : existing
                ? "Save changes"
                : `Create ${kind === "task" ? "follow-up" : kind}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
