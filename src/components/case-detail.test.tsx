// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CaseRecord, Workspace } from "../lib/model";
vi.mock("./case-documents", () => ({ CaseDocuments: () => <input aria-label="Document selection"/> }));
vi.mock("./stage-notifications", () => ({ StageNotifications: () => <textarea aria-label="Notification draft"/> }));
import { CaseDetail } from "./case-detail";
const record: CaseRecord = { id:"case-1", firm_id:"firm-1", ref:"CT/2026/018", buyer:"Kelvin Lim", seller:"Farah Nabila", property:"Maple Grove Terrace", type:"Loan", status:"loan", priority:"high", agent_id:"agent-1", owner:"Hafiz", due_date:"2026-10-30", next_step:"Collect income documents", notes:"Internal case instructions", value:725000, created_at:"2026-10-21T00:00:00Z", updated_at:"2026-10-21T00:00:00Z" };
const workspace: Workspace = {firm:{id:"firm-1",name:"Meridian Legal",email:"team@example.test"}, cases:[record], agents:[{id:"agent-1",firm_id:"firm-1",name:"Zakwan",agency:"Bayview Property",phone:"",email:"",color:"green",created_at:record.created_at}], tasks:[], activities:[]};
afterEach(cleanup);
function setup() { const handlers={onClose:vi.fn(),onEdit:vi.fn(),onSave:vi.fn().mockResolvedValue(undefined),onNote:vi.fn().mockResolvedValue(undefined),onTask:vi.fn()}; render(<CaseDetail c={record} w={workspace} {...handlers}/>); return handlers; }
it("separates sections and preserves unsaved drafts when changing tabs", async () => {
  const user=userEvent.setup(); setup();
  expect(screen.getByRole("heading",{name:"Kelvin Lim"})).toBeTruthy();
  expect(screen.queryByRole("textbox",{name:"Notification draft"})).toBeNull();
  expect(screen.queryByLabelText("Document selection")).toBeNull();
  await user.click(screen.getByRole("tab",{name:"WhatsApp"}));
  await user.type(screen.getByRole("textbox",{name:"Notification draft"}),"Approved stage update");
  await user.click(screen.getByRole("tab",{name:"Activity"}));
  await user.type(screen.getByRole("textbox",{name:"Internal team note"}),"Checking with the bank");
  await user.click(screen.getByRole("tab",{name:"Documents"}));
  await user.type(screen.getByRole("textbox",{name:"Document selection"}),"agreement.pdf");
  await user.click(screen.getByRole("tab",{name:"WhatsApp"}));
  expect((screen.getByRole("textbox",{name:"Notification draft"}) as HTMLTextAreaElement).value).toBe("Approved stage update");
  await user.click(screen.getByRole("tab",{name:"Activity"}));
  expect((screen.getByRole("textbox",{name:"Internal team note"}) as HTMLTextAreaElement).value).toBe("Checking with the bank");
  await user.click(screen.getByRole("tab",{name:"Documents"}));
  expect((screen.getByRole("textbox",{name:"Document selection"}) as HTMLInputElement).value).toBe("agreement.pdf");
});
it("keeps stage changes explicit, cancels drafts and saves through the existing handler", async () => {
  const user=userEvent.setup(); const handlers=setup();
  await user.click(screen.getByRole("button",{name:"Update progress"}));
  await user.selectOptions(screen.getByRole("combobox",{name:"Case stage"}),"stamping");
  expect(screen.getByText(/will queue a WhatsApp update/)).toBeTruthy();
  await user.click(screen.getByRole("button",{name:"Cancel"}));
  expect(handlers.onSave).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button",{name:"Update progress"}));
  expect((screen.getByRole("combobox",{name:"Case stage"}) as HTMLSelectElement).value).toBe("loan");
  await user.clear(screen.getByRole("textbox",{name:"Next action"}));
  await user.type(screen.getByRole("textbox",{name:"Next action"}),"Review signed loan package");
  await user.click(screen.getByRole("button",{name:"Save progress"}));
  expect(handlers.onSave).toHaveBeenCalledWith(expect.objectContaining({id:record.id,status:"loan",next_step:"Review signed loan package",agent_id:"agent-1"}));
});
