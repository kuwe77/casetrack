export const stages = [
  {
    id: "documents",
    label: "Documents",
    full: "Documents received",
    tone: "slate",
  },
  { id: "spa", label: "SPA", full: "SPA preparation", tone: "blue" },
  { id: "loan", label: "Loan", full: "Loan documentation", tone: "violet" },
  {
    id: "redemption",
    label: "Redemption",
    full: "Redemption in progress",
    tone: "amber",
  },
  {
    id: "stamping",
    label: "Stamping",
    full: "Stamping & transfer",
    tone: "teal",
  },
  {
    id: "disbursement",
    label: "Disbursement",
    full: "Disbursement pending",
    tone: "amber",
  },
  { id: "completed", label: "Completed", full: "Completed", tone: "green" },
  { id: "on_hold", label: "On hold", full: "On hold", tone: "red" },
] as const;
export type Stage = (typeof stages)[number]["id"];
export type Priority = "normal" | "high";
export interface CaseRecord {
  id: string;
  firm_id: string;
  ref: string;
  buyer: string;
  seller: string;
  property: string;
  type: "Subsale" | "SPA" | "Loan" | "Refinance";
  status: Stage;
  priority: Priority;
  agent_id: string | null;
  owner: string;
  due_date: string;
  next_step: string;
  notes: string;
  value: number;
  created_at: string;
  updated_at: string;
}
export interface Agent {
  id: string;
  firm_id: string;
  name: string;
  email: string;
  phone: string;
  agency: string;
  color: string;
  created_at: string;
}
export interface FollowUp {
  id: string;
  firm_id: string;
  case_id: string | null;
  title: string;
  due_date: string;
  assignee: string;
  completed: boolean;
  priority: Priority;
  created_at: string;
}
export interface Activity {
  id: string;
  firm_id: string;
  case_id: string | null;
  title: string;
  detail: string;
  kind: "case" | "status" | "note" | "task" | "agent";
  actor: string;
  created_at: string;
}
export interface Firm {
  id: string;
  name: string;
  email: string;
}
export interface Workspace {
  firm: Firm;
  cases: CaseRecord[];
  agents: Agent[];
  tasks: FollowUp[];
  activities: Activity[];
}
export const stageInfo = (id: Stage) => stages.find((s) => s.id === id)!;
export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
export function today() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return ["year", "month", "day"]
    .map((k) => parts.find((p) => p.type === k)?.value)
    .join("-");
}
export function dayOffset(n: number, base = today()) {
  const d = new Date(base + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function dateLabel(value: string, year = false) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(year ? { year: "numeric" as const } : {}),
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(value.length === 10 ? value + "T12:00:00Z" : value));
}
export const isOverdue = (c: CaseRecord) =>
  c.status !== "completed" && !!c.due_date && c.due_date < today();
export const isTaskDue = (t: FollowUp) => !t.completed && t.due_date <= today();
export function money(v: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 0,
  }).format(v);
}
export function compactMoney(v: number) {
  return (
    "RM " +
    new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v)
  );
}
export function caseMatches(c: CaseRecord, q: string) {
  return [c.ref, c.buyer, c.seller, c.property, c.owner].some((v) =>
    v.toLowerCase().includes(q.toLowerCase().trim()),
  );
}
export function csv(cases: CaseRecord[], agents: Agent[]) {
  const safe = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return [
    [
      "Reference",
      "Buyer",
      "Seller",
      "Property",
      "Type",
      "Stage",
      "Priority",
      "Agent",
      "PIC",
      "Target date",
      "Next step",
      "Property value (MYR)",
    ],
    ...cases.map((c) => [
      c.ref,
      c.buyer,
      c.seller,
      c.property,
      c.type,
      stageInfo(c.status).full,
      c.priority,
      agents.find((a) => a.id === c.agent_id)?.name || "",
      c.owner,
      c.due_date,
      c.next_step,
      c.value,
    ]),
  ]
    .map((r) => r.map(safe).join(","))
    .join("\r\n");
}
export function downloadCsv(cases: CaseRecord[], agents: Agent[]) {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + csv(cases, agents)], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `jurisync-cases-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
