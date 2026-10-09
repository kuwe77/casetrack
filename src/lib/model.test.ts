import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  today,
  dayOffset,
  isOverdue,
  isTaskDue,
  csv,
  caseMatches,
} from "./model";
import { makeSeed } from "./seed";
describe("case workflow rules", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T18:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());
  it("uses the Kuala Lumpur business date across the UTC boundary", () => {
    expect(today()).toBe("2026-10-09");
    expect(dayOffset(-1)).toBe("2026-10-08");
  });
  it("does not flag completed cases as overdue", () => {
    const c = makeSeed().cases[0];
    expect(
      isOverdue({ ...c, status: "completed", due_date: "2026-10-01" }),
    ).toBe(false);
    expect(isOverdue({ ...c, status: "loan", due_date: "2026-10-01" })).toBe(
      true,
    );
    expect(isOverdue({ ...c, due_date: today() })).toBe(false);
  });
  it("includes today and overdue follow-ups but excludes completed work", () => {
    const t = makeSeed().tasks[0];
    expect(isTaskDue({ ...t, due_date: today(), completed: false })).toBe(true);
    expect(isTaskDue({ ...t, completed: true })).toBe(false);
    expect(isTaskDue({ ...t, due_date: dayOffset(1) })).toBe(false);
  });
  it("searches client, property and reference without case sensitivity", () => {
    const c = makeSeed().cases[0];
    expect(caseMatches(c, "AHMAD")).toBe(true);
    expect(caseMatches(c, "setia")).toBe(true);
    expect(caseMatches(c, c.ref)).toBe(true);
    expect(caseMatches(c, "notfound")).toBe(false);
  });
  it("escapes quotes, delimiters and spreadsheet formula injection on export", () => {
    const w = makeSeed();
    const text = csv(
      [{ ...w.cases[0], buyer: '=HYPERLINK("bad")', property: "A, B\nC" }],
      w.agents,
    );
    expect(text).toContain('"\'=HYPERLINK(""bad"")"');
    expect(text).toContain('"A, B\nC"');
  });
});
