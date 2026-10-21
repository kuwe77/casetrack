import { useEffect, useState, type FormEvent } from "react";
import { Tabs } from "radix-ui";
import { ArrowRight, CalendarBlank, Check, CheckCircle, ClockCounterClockwise, FileText, PencilSimple, Plus, WarningCircle, X } from "@phosphor-icons/react";
import type { CaseRecord, FollowUp, Stage, Workspace } from "../lib/model";
import { dateLabel, isOverdue, money, stages } from "../lib/model";
import { errorMessage } from "../lib/repository";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from "./ui/dialog";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Avatar, Badge } from "./ui";
import { CaseDocuments } from "./case-documents";
import { StageNotifications } from "./stage-notifications";
import "./case-detail.css";

export function CaseDetail({ c, w, onClose, onEdit, onSave, onNote, onTask }: {
  c: CaseRecord; w: Workspace; onClose: () => void; onEdit: () => void;
  onSave: (record: CaseRecord) => Promise<void>; onNote: (note: string) => Promise<void>; onTask: (task: FollowUp) => void;
}) {
  const [tab, setTab] = useState("overview"), [editing, setEditing] = useState(false);
  const [documentsOpened, setDocumentsOpened] = useState(false);
  const [status, setStatus] = useState(c.status), [next, setNext] = useState(c.next_step), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const agent = w.agents.find(a => a.id === c.agent_id), events = w.activities.filter(a => a.case_id === c.id);
  const tasks = w.tasks.filter(t => t.case_id === c.id), openTasks = tasks.filter(t => !t.completed);
  useEffect(() => { setStatus(c.status); setNext(c.next_step); }, [c.status, c.next_step]);
  async function progress(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (!next.trim()) throw Error("Add a next action for this case.");
      await onSave({ ...c, status, next_step: next.trim(), updated_at: new Date().toISOString() });
      setEditing(false);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  function taskRow(task: FollowUp) {
    return <li className={task.completed ? "case-task is-complete" : "case-task"} key={task.id}>
      <button type="button" className="case-task-toggle" onClick={() => onTask(task)} aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}>
        {task.completed ? <Check size={16} weight="bold"/> : <span/>}
      </button>
      <div><strong>{task.title}</strong><span>{task.assignee || "Unassigned"}{task.due_date && ` · ${dateLabel(task.due_date)}`}</span></div>
      {task.priority === "high" && <span className="case-task-priority">Priority</span>}
    </li>;
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent showCloseButton={false} className="case-sheet">
      <header className="case-sheet-header">
        <div className="case-sheet-topline"><span>{c.ref}<i>·</i>{c.type}</span>
          <div><Button variant="ghost" size="sm" onClick={onEdit} disabled={busy}><PencilSimple size={16}/>Edit case</Button>
            <DialogClose aria-label="Close case" disabled={busy} className="case-close"><X size={20}/></DialogClose></div>
        </div>
        <DialogTitle className="case-sheet-title">{c.buyer}</DialogTitle>
        <DialogDescription className="case-sheet-address">{c.property || "No property address added"}</DialogDescription>
        <div className="case-sheet-status"><Badge status={c.status}/>{c.priority === "high" && <span><WarningCircle size={15}/>High priority</span>}</div>
      </header>
      <Tabs.Root value={tab} onValueChange={value => { setTab(value); if (value === "documents") setDocumentsOpened(true); }} className="case-sheet-tabs">
        <Tabs.List aria-label="Case sections" className="case-sheet-navigation">
          <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger value="whatsapp">WhatsApp</Tabs.Trigger>
          <Tabs.Trigger value="documents">Documents</Tabs.Trigger>
          <Tabs.Trigger value="activity" aria-label="Activity">Activity<span aria-hidden="true">{events.length}</span></Tabs.Trigger>
        </Tabs.List>
        <div className="case-sheet-scroll">
          <Tabs.Content value="overview" forceMount hidden={tab !== "overview"} className="case-sheet-content">
            <section className="case-next-action" aria-labelledby="case-next-heading">
              <div className="case-section-heading"><h3 id="case-next-heading">Next action</h3>
                {!editing && <Button variant="outline" size="sm" onClick={() => { setError(""); setEditing(true); }}>Update progress<ArrowRight size={15}/></Button>}</div>
              {editing ? <form onSubmit={progress} className="case-progress-editor">
                <label><span>Case stage</span><select value={status} onChange={e => setStatus(e.target.value as Stage)} disabled={busy}>
                  {stages.map(stage => <option value={stage.id} key={stage.id}>{stage.full}</option>)}</select></label>
                <label><span>Next action</span><Textarea aria-label="Next action" rows={3} required maxLength={500} value={next} onChange={e => setNext(e.target.value)} disabled={busy}/></label>
                {status !== c.status && <p className="case-help">Saving a selected notification stage will queue a WhatsApp update. Review the choices in the WhatsApp tab.</p>}
                {error && <p role="alert" className="form-error">{error}</p>}
                <div className="case-form-actions"><Button disabled={busy}>{busy ? "Saving…" : "Save progress"}</Button>
                  <Button variant="ghost" type="button" disabled={busy} onClick={() => { setEditing(false); setStatus(c.status); setNext(c.next_step); setError(""); }}>Cancel</Button></div>
              </form> : <><p className="case-next-text">{c.next_step || "Add the next action to keep this case moving."}</p>
                <div className={`case-target ${isOverdue(c) ? "case-target-overdue" : ""}`}><CalendarBlank size={16}/>
                  {c.due_date ? <>Target completion <strong>{dateLabel(c.due_date, true)}</strong>{isOverdue(c) && <span>Overdue</span>}</> : "No target date set"}</div></>}
            </section>
            <section className="case-people" aria-label="Assigned people">
              <div><Avatar name={c.owner || "Unassigned"}/><div><span>Person in charge</span><strong>{c.owner || "Unassigned"}</strong></div></div>
              <div><Avatar name={agent?.name || "Unassigned"} color={agent?.color}/><div><span>Property agent</span><strong>{agent?.name || "Unassigned"}</strong></div></div>
            </section>
            <section className="case-information" aria-labelledby="case-information-heading">
              <h3 id="case-information-heading">Case details</h3>
              <dl><div><dt>Seller</dt><dd>{c.seller || "Not provided"}</dd></div><div><dt>Property value</dt><dd>{money(c.value)}</dd></div>
                <div><dt>Opened</dt><dd>{dateLabel(c.created_at, true)}</dd></div><div><dt>Last updated</dt><dd>{dateLabel(c.updated_at, true)}</dd></div></dl>
            </section>
            <section className="case-followups" aria-labelledby="case-followups-heading">
              <div className="case-section-heading"><h3 id="case-followups-heading">Follow-ups</h3><span className="case-count">{openTasks.length} open</span></div>
              {openTasks.length ? <ul>{openTasks.map(taskRow)}</ul> : <p className="case-help">No outstanding follow-ups.</p>}
              {tasks.some(t => t.completed) && <details className="case-completed"><summary><CheckCircle size={16}/>{tasks.length - openTasks.length} completed</summary><ul>{tasks.filter(t => t.completed).map(taskRow)}</ul></details>}
            </section>
            {c.notes && <details className="case-internal-notes"><summary><FileText size={17}/>Internal case notes<span>Team only</span></summary><p>{c.notes}</p></details>}
          </Tabs.Content>
          <Tabs.Content value="whatsapp" forceMount hidden={tab !== "whatsapp"} className="case-sheet-content">
            <StageNotifications key={c.id} record={c} agentName={agent?.name}/>
          </Tabs.Content>
          <Tabs.Content value="documents" forceMount hidden={tab !== "documents"} className="case-sheet-content">{documentsOpened && <CaseDocuments caseId={c.id}/>}</Tabs.Content>
          <Tabs.Content value="activity" forceMount hidden={tab !== "activity"} className="case-sheet-content">
            <section className="case-note-composer"><h3>Add a team note</h3><p className="case-help">Only your team can read these notes.</p>
              <form onSubmit={async e => { e.preventDefault(); if (!note.trim()) return; setBusy(true); setError("");
                try { await onNote(note.trim()); setNote(""); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
              }}><Textarea aria-label="Internal team note" value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={5000} required disabled={busy} placeholder="Write an update for your team…"/>
                <Button disabled={busy || !note.trim()}><Plus size={16}/>{busy ? "Adding…" : "Add note"}</Button>
                {error && <p className="form-error" role="alert">{error}</p>}
              </form>
            </section>
            <section className="case-activity"><h3>Case activity</h3>
              {events.length ? <ol>{events.map(event => <li key={event.id}><ClockCounterClockwise size={17}/><div><h4>{event.title}</h4><p>{event.detail}</p><small>{dateLabel(event.created_at)} · {event.actor}</small></div></li>)}</ol> : <p className="case-help">No updates recorded yet.</p>}
            </section>
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </DialogContent>
  </Dialog>;
}
