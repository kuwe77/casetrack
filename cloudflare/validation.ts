import { z } from "zod";
const short = z.string().trim().max(150);
const text = z.string().max(10000).default("");
const date = z.union([z.literal(""), z.iso.date(), z.null()]).optional().transform(v => v || null);
const relation = z.union([z.uuid(), z.null()]).optional().default(null);
export const schemas = {
  cases: z.object({
    ref: short.min(1), buyer: short.min(1), seller: text, property: text,
    type: z.enum(["Subsale", "SPA", "Loan", "Refinance"]).default("Subsale"),
    status: z.enum(["documents", "spa", "loan", "redemption", "stamping", "disbursement", "completed", "on_hold"]).default("documents"),
    priority: z.enum(["normal", "high"]).default("normal"), agent_id: relation, owner: text,
    due_date: date, next_step: text, notes: text, value: z.number().finite().min(0).max(99999999999999).default(0),
  }),
  agents: z.object({
    name: short.min(1), email: z.union([z.email(), z.literal("")]).default(""),
    phone: z.string().max(40).default(""), agency: short.default(""),
    color: z.enum(["lime","blue","peach","lavender","green","rose","teal","amber","violet"]).default("teal"),
  }),
  tasks: z.object({
    case_id: relation, title: short.min(1), due_date: date, assignee: short.default(""),
    completed: z.boolean().default(false), priority: z.enum(["normal", "high"]).default("normal"),
  }),
};
export type Resource = keyof typeof schemas;
