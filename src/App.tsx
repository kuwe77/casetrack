import { useState, useEffect, useCallback, useRef } from "react";
import type { FormEvent } from "react";
import {
  SquaresFour,
  FolderSimple,
  CheckSquare,
  UsersThree,
  ClockCounterClockwise,
  GearSix,
  MagnifyingGlass,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Export,
  CaretDown,
  CaretRight,
  Bell,
  Check,
  CalendarBlank,
  Clock,
  WarningCircle,
  HouseLine,
  Buildings,
  Lightning,
  SidebarSimple,
  SlidersHorizontal,
  Rows,
  Kanban,
  PencilSimple,
  ChatTeardropText,
  X,
  SpinnerGap,
  CheckCircle,
  EnvelopeSimple,
  Phone,
  ShieldCheck,
} from "@phosphor-icons/react";
import type {
  CaseRecord,
  Workspace,
  Agent,
  FollowUp,
  Stage,
} from "./lib/model";
import {
  stages,
  stageInfo,
  today,
  dayOffset,
  dateLabel,
  isOverdue,
  isTaskDue,
  money,
  compactMoney,
  caseMatches,
  downloadCsv,
} from "./lib/model";
import {
  loadWorkspace,
  saveCase,
  saveAgent,
  saveTask,
  saveFirm,
  addNote,
  errorMessage,
} from "./lib/repository";
import {
  Modal,
  Avatar,
  Badge,
  AgentName,
  Empty,
  SectionTitle,
  TextLink,
} from "./components/ui";
import { Editor } from "./components/forms";
import { WorkspaceSetup } from "./components/workspace-setup";
import { FolderKanban, Sun, Moon } from "lucide-react";
import { Button } from "./components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./components/ui/table";
import { Card } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";

type Page =
  "overview" | "cases" | "followups" | "agents" | "activity" | "settings";
type Edit = {
  kind: "case" | "agent" | "task";
  existing?: CaseRecord | Agent | FollowUp;
};
const navigation = [
  { id: "overview", label: "Overview", icon: SquaresFour },
  { id: "cases", label: "Cases", icon: FolderSimple },
  { id: "followups", label: "Follow-ups", icon: CheckSquare },
  { id: "agents", label: "Agents", icon: UsersThree },
  { id: "activity", label: "Activity", icon: ClockCounterClockwise },
] as const;
export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const reload = useCallback(async () => {
    setError("");
    try {
      setWorkspace(await loadWorkspace());
    } catch (e) {
      setError(errorMessage(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload().catch(() => {});
  }, [reload]);
  if (error && !workspace)
    return (
      <div className="center-state">
        <WarningCircle size={32} />
        <h1>Could not open workspace</h1>
        <p>{error}</p>
        <Button
          onClick={() => {
            setError("");
            void reload().catch(() => {});
          }}
        >
          Try again
        </Button>
      </div>
    );
  if (loading)
    return (
      <div className="center-state">
        <SpinnerGap className="spin" size={24} />
        <p>Opening workspace…</p>
      </div>
    );
  if (!workspace)
    return <WorkspaceSetup onReady={() => void reload().catch(() => {})} />;
  return (
    <Dashboard workspace={workspace} reload={reload} refreshError={error} />
  );
}
function Dashboard({
  workspace: w,
  reload,
  refreshError,
}: {
  workspace: Workspace;
  reload: () => Promise<void>;
  refreshError: string;
}) {
  const [dark, setDark] = useState(
    () => localStorage.getItem("casetrack-theme") === "dark",
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("casetrack-theme", dark ? "dark" : "light");
  }, [dark]);
  const [page, setPage] = useState<Page>(() => {
    const h = location.hash.slice(1);
    return [
      "overview",
      "cases",
      "followups",
      "agents",
      "activity",
      "settings",
    ].includes(h)
      ? (h as Page)
      : "overview";
  });
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [mobileNav, setMobileNav] = useState(false),
    [editor, setEditor] = useState<Edit | null>(null),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [searchOpen, setSearchOpen] = useState(false),
    [query, setQuery] = useState(""),
    [notifications, setNotifications] = useState(false),
    [toast, setToast] = useState(""),
    [busyTask, setBusyTask] = useState<string | null>(null),
    [caseTab, setCaseTab] = useState("all");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  function go(p: Page) {
    setPage(p);
    location.hash = p;
    setMobileNav(false);
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileNav(false);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    }
    function hash() {
      const h = location.hash.slice(1);
      if (
        [
          "overview",
          "cases",
          "followups",
          "agents",
          "activity",
          "settings",
        ].includes(h)
      )
        setPage(h as Page);
    }
    window.addEventListener("keydown", key);
    window.addEventListener("hashchange", hash);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("hashchange", hash);
    };
  }, []);
  const selected = w.cases.find((c) => c.id === selectedId),
    due = w.tasks.filter(isTaskDue),
    overdue = w.cases.filter(isOverdue);
  const activeCases = w.cases.filter((c) => c.status !== "completed");
  const openTasks = w.tasks.filter((t) => !t.completed);
  const weekTasks = openTasks.filter(
    (t) => t.due_date >= today() && t.due_date <= dayOffset(6),
  );
  const activeValue = activeCases.reduce((sum, c) => sum + c.value, 0);
  const totalValue = w.cases.reduce((sum, c) => sum + c.value, 0);
  async function submit(
    kind: Edit["kind"],
    record: CaseRecord | Agent | FollowUp,
  ) {
    if (kind === "case") await saveCase(record as CaseRecord);
    else if (kind === "agent") await saveAgent(record as Agent);
    else await saveTask(record as FollowUp);
    await reload();
    notify(
      `${kind === "task" ? "Follow-up" : kind === "case" ? "Case" : "Agent"} saved`,
    );
  }
  async function toggleTask(t: FollowUp) {
    setBusyTask(t.id);
    try {
      await saveTask({ ...t, completed: !t.completed });
      await reload();
      notify(t.completed ? "Follow-up reopened" : "Follow-up completed");
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setBusyTask(null);
    }
  }
  const currentLabel =
    page === "settings"
      ? "Settings"
      : navigation.find((n) => n.id === page)?.label;
  return (
    <div className="app-shell">
      {mobileNav && (
        <Button
          variant="ghost"
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        inert={narrow && !mobileNav}
        className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}
      >
        <a className="brand" href="#overview" onClick={() => go("overview")}>
          <div className="brand-mark">
            <FolderKanban size={20} />
          </div>
          <span>CaseTrack</span>
        </a>
        <Button
          variant="ghost"
          className="workspace-switch"
          onClick={() => go("settings")}
        >
          <span className="workspace-monogram">
            <Buildings size={20} />
          </span>
          <span>
            <strong>{w.firm.name}</strong>
            <small>Conveyancing workspace</small>
          </span>
          <CaretDown size={14} />
        </Button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((n) => (
            <Button
              variant="ghost"
              key={n.id}
              className={`nav-item ${page === n.id ? "active" : ""}`}
              onClick={() => go(n.id)}
              aria-current={page === n.id ? "page" : undefined}
            >
              <n.icon size={21} weight={page === n.id ? "fill" : "regular"} />
              <span>{n.label}</span>
              {n.id === "followups" && due.length > 0 && (
                <span className="nav-count">{due.length}</span>
              )}
            </Button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="small-orbit" />
            <span>
              Private by default
              <br />
              Open source, on your computer.
            </span>
          </div>
          <Button
            variant="ghost"
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            onClick={() => go("settings")}
          >
            <GearSix size={21} />
            <span>Settings</span>
          </Button>
          <div className="sidebar-person">
            <Avatar name="Workspace Admin" color="lime" />
            <span>
              <strong>Workspace admin</strong>
              <small>Encrypted workspace</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <a
            className="desktop-brand"
            href="#overview"
            onClick={() => go("overview")}
            aria-label="CaseTrack overview"
          >
            <span className="brand-mark">
              <FolderKanban size={23} />
            </span>
          </a>
          <nav className="desktop-navigation" aria-label="Main navigation">
            {navigation.map((n) => (
              <Button
                key={n.id}
                variant="ghost"
                className={page === n.id ? "selected" : ""}
                aria-current={page === n.id ? "page" : undefined}
                onClick={() => go(n.id)}
              >
                {n.label}
              </Button>
            ))}
          </nav>
          <div className="breadcrumbs">
            <Button
              variant="ghost"
              className="icon-button mobile-menu"
              onClick={() => setMobileNav(true)}
              aria-label="Open navigation"
            >
              <SidebarSimple size={22} />
            </Button>
            <span>Workspace</span>
            <CaretRight size={12} />
            <strong>{currentLabel}</strong>
          </div>
          <div className="topbar-actions">
            <Button
              variant="ghost"
              className="global-search"
              aria-label="Find a case"
              onClick={() => {
                setQuery("");
                setSearchOpen(true);
              }}
            >
              <MagnifyingGlass size={18} />
              <span>Find a case…</span>
              <kbd>⌘ K</kbd>
            </Button>
            <span className="topbar-divider" />
            <Button
              variant="ghost"
              size="icon"
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </Button>
            <Button
              variant="ghost"
              className="icon-button notification-button"
              aria-label={`Notifications, ${due.length} due follow-ups`}
              onClick={() => setNotifications(true)}
            >
              <Bell size={20} />
              {due.length > 0 && <i />}
            </Button>
            <Button
              variant="ghost"
              className="header-workspace"
              onClick={() => go("settings")}
              aria-label={`Workspace settings: ${w.firm.name}`}
              title={w.firm.name}
            >
              <Avatar name={w.firm.name} small />
              <span>{w.firm.name}</span>
              <GearSix size={17} />
            </Button>
          </div>
        </header>
        <main className="main-content">
          {refreshError && (
            <div className="sync-error" role="alert">
              <span>Could not refresh records: {refreshError}</span>
              <Button
                variant="ghost"
                onClick={() => void reload().catch(() => {})}
              >
                Retry
              </Button>
            </div>
          )}
          {page === "overview" && (
            <>
              <div className="page-heading overview-heading">
                <div>
                  <span className="eyebrow">
                    {new Intl.DateTimeFormat("en-GB", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      timeZone: "Asia/Kuala_Lumpur",
                    }).format(new Date())}
                  </span>
                  <h1>Overview</h1>
                  <p>A snapshot of your cases, deadlines and recent work.</p>
                </div>
                <Button
                  variant="ghost"
                  className="button button-primary"
                  onClick={() => setEditor({ kind: "case" })}
                >
                  <Plus size={18} />
                  New case
                </Button>
              </div>
              <div className="stats-strip">
                <Stat
                  label="Active cases"
                  tone="mint"
                  current={activeCases.length}
                  total={w.cases.length}
                  meterLabel={`${activeCases.length} of ${w.cases.length} matters active`}
                  value={activeCases.length.toString()}
                  icon={<FolderSimple size={19} />}
                  detail={`${w.agents.length} property agents in your network`}
                  onClick={() => {
                    setCaseTab("active");
                    go("cases");
                  }}
                />
                <Stat
                  label="Needs attention"
                  value={overdue.length.toString().padStart(2, "0")}
                  icon={<WarningCircle size={19} />}
                  detail="Cases past their target date"
                  tone="coral"
                  current={overdue.length}
                  total={activeCases.length}
                  meterLabel={`${overdue.length} of ${activeCases.length} active matters overdue`}
                  onClick={() => {
                    setCaseTab("attention");
                    go("cases");
                  }}
                />
                <Stat
                  label="Due this week"
                  tone="lilac"
                  current={weekTasks.length}
                  total={openTasks.length}
                  meterLabel={`${weekTasks.length} of ${openTasks.length} open follow-ups`}
                  value={weekTasks.length.toString().padStart(2, "0")}
                  icon={<CalendarBlank size={19} />}
                  detail="Follow-ups over the next 7 days"
                  onClick={() => go("followups")}
                />
                <Stat
                  label="Active portfolio"
                  showMeter={false}
                  tone="rose"
                  current={activeValue}
                  total={totalValue}
                  meterLabel={`${compactMoney(totalValue)} across all matters`}
                  value={compactMoney(activeValue)}
                  icon={<HouseLine size={19} />}
                  detail="Total property value · MYR"
                />
              </div>
              <div className="overview-panels">
                <Card className="panel pipeline-panel">
                  <SectionTitle
                    title="Case pipeline"
                    subtitle="Active matters, by current milestone"
                    action={
                      <TextLink onClick={() => go("cases")}>
                        View cases
                      </TextLink>
                    }
                  />
                  <div className="pipeline-chart">
                    {stages.slice(0, 6).map((s, i) => {
                      const count = w.cases.filter(
                          (c) => c.status === s.id,
                        ).length,
                        max = Math.max(
                          3,
                          ...stages
                            .slice(0, 6)
                            .map(
                              (s) =>
                                w.cases.filter((c) => c.status === s.id).length,
                            ),
                        );
                      return (
                        <Button
                          variant="ghost"
                          className={`pipeline-column pipeline-${i} tone-${s.tone}`}
                          key={s.id}
                          onClick={() => {
                            setCaseTab(s.id);
                            go("cases");
                          }}
                          aria-label={`${s.full}: ${count} cases`}
                        >
                          <span className="pipeline-count">
                            {count.toString().padStart(2, "0")}
                          </span>
                          <span className="pipeline-track">
                            <span
                              style={{ height: `${(count / max) * 100}%` }}
                            />
                          </span>
                          <span className="pipeline-label">
                            {s.label === "Disbursement" ? "Funds" : s.label}
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                  <div className="pipeline-footer">
                    <span>
                      <i className="legend-dot" />
                      {
                        w.cases.filter(
                          (c) => !["completed", "on_hold"].includes(c.status),
                        ).length
                      }{" "}
                      matters moving forward
                    </span>
                    <span>
                      {w.cases.filter((c) => c.status === "on_hold").length} on
                      hold
                    </span>
                  </div>
                </Card>
                <Card className="panel focus-panel">
                  <SectionTitle
                    title="Next up"
                    subtitle={`${due.length} ${due.length === 1 ? "follow-up needs" : "follow-ups need"} attention`}
                    action={
                      <span className="focus-icon">
                        <Lightning size={20} weight="fill" />
                      </span>
                    }
                  />
                  <div className="focus-list">
                    {due.length ? (
                      due
                        .slice(0, 3)
                        .map((t) => (
                          <TaskLine
                            key={t.id}
                            task={t}
                            caseRecord={w.cases.find((c) => c.id === t.case_id)}
                            onToggle={() => toggleTask(t)}
                            disabled={busyTask === t.id}
                            onOpen={() =>
                              setEditor({ kind: "task", existing: t })
                            }
                          />
                        ))
                    ) : (
                      <div className="focus-empty">
                        <CheckCircle size={28} />
                        <p>You’re all caught up for today.</p>
                      </div>
                    )}
                  </div>
                  <TextLink onClick={() => go("followups")}>
                    All follow-ups
                  </TextLink>
                </Card>
              </div>
              <Card className="panel cases-panel">
                <SectionTitle
                  title="Recent cases"
                  subtitle="Your most recently updated matters"
                  action={
                    <TextLink onClick={() => go("cases")}>All cases</TextLink>
                  }
                />
                <CaseTable
                  cases={[...w.cases]
                    .filter((c) => c.status !== "completed")
                    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                    .slice(0, 5)}
                  agents={w.agents}
                  onOpen={setSelectedId}
                />
              </Card>
              <div className="page-footnote">
                <span className="foot-brand">casetrack.</span>
                <span>Open source · Local first</span>
                <span>Malaysia · MYR</span>
              </div>
            </>
          )}
          {page === "cases" && (
            <CasesPage
              w={w}
              tab={caseTab}
              setTab={setCaseTab}
              onOpen={setSelectedId}
              onNew={() => setEditor({ kind: "case" })}
              notify={notify}
            />
          )}
          {page === "followups" && (
            <FollowupsPage
              w={w}
              onEdit={(t) => setEditor({ kind: "task", existing: t })}
              onNew={() => setEditor({ kind: "task" })}
              toggle={toggleTask}
              busyTask={busyTask}
              onCase={setSelectedId}
            />
          )}
          {page === "agents" && (
            <AgentsPage
              w={w}
              onEdit={(a) => setEditor({ kind: "agent", existing: a })}
              onNew={() => setEditor({ kind: "agent" })}
              onCase={setSelectedId}
            />
          )}
          {page === "activity" && <ActivityPage w={w} onCase={setSelectedId} />}
          {page === "settings" && (
            <SettingsPage
              w={w}
              onSave={async (firm) => {
                await saveFirm(firm);
                await reload();
                notify("Workspace settings saved");
              }}
            />
          )}
        </main>
      </div>
      {editor && (
        <Editor
          key={`${editor.kind}-${editor.existing?.id || "new"}`}
          kind={editor.kind}
          existing={editor.existing}
          workspace={w}
          onClose={() => setEditor(null)}
          onSave={submit}
        />
      )}
      {selected && (
        <CaseDetail
          c={selected}
          w={w}
          onClose={() => setSelectedId(null)}
          onEdit={() => {
            setEditor({ kind: "case", existing: selected });
            setSelectedId(null);
          }}
          onSave={async (c) => {
            await saveCase(c);
            await reload();
            notify("Case progress updated");
          }}
          onNote={async (note) => {
            await addNote(w.firm.id, selected.id, note);
            await reload();
            notify("Internal note added");
          }}
          onTask={(t) => toggleTask(t)}
        />
      )}
      <Modal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        title="Find a case"
        description="Search by reference, client, property or person in charge."
      >
        <div className="search-input">
          <MagnifyingGlass size={20} />
          <Input
            autoFocus
            placeholder="Type to search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="search-results">
          {w.cases
            .filter((c) => caseMatches(c, query))
            .slice(0, 8)
            .map((c) => (
              <Button
                variant="ghost"
                key={c.id}
                onClick={() => {
                  setSearchOpen(false);
                  setSelectedId(c.id);
                }}
              >
                <span className="case-icon">
                  <FolderSimple size={20} />
                </span>
                <span>
                  <strong>{c.buyer}</strong>
                  <small>
                    {c.ref} · {c.property}
                  </small>
                </span>
                <ArrowUpRight size={17} />
              </Button>
            ))}
          {!w.cases.some((c) => caseMatches(c, query)) && (
            <Empty
              title="No matching cases"
              description="Try a client name, reference or property address."
            />
          )}
        </div>
      </Modal>
      <Modal
        open={notifications}
        onClose={() => setNotifications(false)}
        title="Next up"
        description="Open follow-ups due today or earlier."
      >
        <div className="notification-list">
          {due.length ? (
            due.map((t) => (
              <TaskLine
                key={t.id}
                task={t}
                caseRecord={w.cases.find((c) => c.id === t.case_id)}
                onToggle={() => toggleTask(t)}
                disabled={busyTask === t.id}
                onOpen={() => {
                  setNotifications(false);
                  go("followups");
                }}
              />
            ))
          ) : (
            <Empty
              title="You’re all caught up"
              description="No overdue or due-today follow-ups."
            />
          )}
        </div>
      </Modal>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle size={20} />
          {toast}
          <Button
            variant="ghost"
            onClick={() => setToast("")}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </Button>
        </div>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  detail,
  icon,
  tone,
  current,
  total,
  meterLabel,
  showMeter = true,
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  tone: string;
  current: number;
  total: number;
  meterLabel: string;
  showMeter?: boolean;
  onClick?: () => void;
}) {
  const contents = (
    <>
      <div className="stat-label">
        {label}
        <span>{icon}</span>
      </div>
      <div className={`stat-value ${tone || ""}`}>{value}</div>
      <div className="stat-detail">{detail}</div>
      <div className="stat-meter-caption">
        <span>{meterLabel}</span>
        {showMeter && (
          <span>{total ? Math.round((current / total) * 100) : 0}%</span>
        )}
      </div>
      {showMeter ? (
        <div
          className="stat-meter"
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={total ? Math.round((current / total) * 100) : 0}
          aria-valuetext={meterLabel}
        >
          <span
            style={{
              width: `${total ? Math.min(100, (current / total) * 100) : 0}%`,
            }}
          />
        </div>
      ) : (
        <div className="portfolio-caption">
          {current
            ? "Value of ongoing matters"
            : "No active property value yet"}
        </div>
      )}
    </>
  );
  return (
    <Card className={`stat-card stat-${tone}`}>
      {onClick ? (
        <Button variant="ghost" className="stat" onClick={onClick}>
          {contents}
        </Button>
      ) : (
        <div className="stat">{contents}</div>
      )}
    </Card>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function CaseTable({
  cases,
  agents,
  onOpen,
}: {
  cases: CaseRecord[];
  agents: Agent[];
  onOpen: (id: string) => void;
}) {
  if (!cases.length)
    return (
      <Empty
        title="A clean slate"
        description="No cases match this view. Create a case or adjust your filters."
      />
    );
  return (
    <div className="table-scroll">
      <Table className="case-table">
        <TableHeader>
          <TableRow>
            <TableHead>Case / property</TableHead>
            <TableHead>Current milestone</TableHead>
            <TableHead>Agent</TableHead>
            <TableHead>Target date</TableHead>
            <TableHead>
              <span className="sr-only">Open case</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cases.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <Button
                  variant="ghost"
                  className="case-title"
                  onClick={() => onOpen(c.id)}
                >
                  <span className="case-icon">
                    <HouseLine size={21} weight="light" />
                  </span>
                  <span>
                    <strong>
                      {c.buyer}
                      {c.priority === "high" && (
                        <span className="priority-dot" title="High priority" />
                      )}
                    </strong>
                    <small>
                      {c.ref} <span>·</span> {c.property}
                    </small>
                  </span>
                </Button>
              </TableCell>
              <TableCell>
                <Badge status={c.status} />
              </TableCell>
              <TableCell>
                <AgentName agent={agents.find((a) => a.id === c.agent_id)} />
              </TableCell>
              <TableCell>
                <span className={`due-date ${isOverdue(c) ? "overdue" : ""}`}>
                  {dateLabel(c.due_date)}
                  {isOverdue(c) && <small>Overdue</small>}
                </span>
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  className="row-open icon-button"
                  onClick={() => onOpen(c.id)}
                  aria-label={`Open case ${c.ref}`}
                >
                  <ArrowUpRight size={18} />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
function CasesPage({
  w,
  tab,
  setTab,
  onOpen,
  onNew,
  notify,
}: {
  w: Workspace;
  tab: string;
  setTab: (s: string) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  notify: (m: string) => void;
}) {
  const [search, setSearch] = useState(""),
    [type, setType] = useState("all"),
    [agent, setAgent] = useState("all"),
    [sort, setSort] = useState("updated"),
    [board, setBoard] = useState(false),
    [filters, setFilters] = useState(false);
  const filtered = w.cases
    .filter(
      (c) =>
        caseMatches(c, search) &&
        (type === "all" || c.type === type) &&
        (agent === "all" || c.agent_id === agent) &&
        (tab === "all" ||
          (tab === "active" && c.status !== "completed") ||
          (tab === "attention" && isOverdue(c)) ||
          c.status === tab),
    )
    .sort((a, b) =>
      sort === "due"
        ? a.due_date.localeCompare(b.due_date)
        : sort === "name"
          ? a.buyer.localeCompare(b.buyer)
          : b.updated_at.localeCompare(a.updated_at),
    );
  return (
    <>
      <PageHeading
        eyebrow="CASE MANAGEMENT"
        title="Case register"
        description="Keep your files moving, from first instruction to completion."
        action={
          <div className="heading-actions">
            <Button
              variant="ghost"
              className="button button-secondary"
              onClick={() => {
                downloadCsv(filtered, w.agents);
                notify(`${filtered.length} cases exported`);
              }}
            >
              <Export size={17} />
              Export
            </Button>
            <Button
              variant="ghost"
              className="button button-primary"
              onClick={onNew}
            >
              <Plus size={18} />
              New case
            </Button>
          </div>
        }
      />
      <Card className="panel">
        <div className="case-controls">
          <div className="tabs">
            {[
              ["all", "All cases"],
              ["active", "Active"],
              ["attention", "Needs attention"],
              ["completed", "Completed"],
            ].map(([id, label]) => (
              <Button
                variant="ghost"
                className={tab === id ? "selected" : ""}
                key={id}
                onClick={() => setTab(id)}
              >
                {label}
                <span>
                  {
                    w.cases.filter(
                      (c) =>
                        id === "all" ||
                        (id === "active" && c.status !== "completed") ||
                        (id === "attention" && isOverdue(c)) ||
                        (id === "completed" && c.status === "completed"),
                    ).length
                  }
                </span>
              </Button>
            ))}
            {!["all", "active", "attention", "completed"].includes(tab) && (
              <Button
                variant="ghost"
                className="selected"
                onClick={() => setTab("all")}
              >
                {stageInfo(tab as Stage).label}
                <X size={13} />
              </Button>
            )}
          </div>
        </div>
        <div className="table-toolbar">
          <div className="search-input">
            <MagnifyingGlass size={18} />
            <Input
              aria-label="Search cases"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cases, clients, properties…"
            />
          </div>
          <div className="toolbar-right">
            <Button
              variant="ghost"
              className={`button button-secondary button-small ${filters ? "is-active" : ""}`}
              onClick={() => setFilters(!filters)}
              aria-expanded={filters}
            >
              <SlidersHorizontal size={17} />
              Filters
              {(type !== "all" || agent !== "all") && (
                <span className="filter-dot" />
              )}
            </Button>
            <select
              className="sort-select"
              aria-label="Sort cases"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="updated">Last updated</option>
              <option value="due">Target date</option>
              <option value="name">Client name</option>
            </select>
            <div className="view-switch">
              <Button
                variant="ghost"
                aria-label="Table view"
                aria-pressed={!board}
                onClick={() => setBoard(false)}
              >
                <Rows size={18} />
              </Button>
              <Button
                variant="ghost"
                aria-label="Board view"
                aria-pressed={board}
                onClick={() => setBoard(true)}
              >
                <Kanban size={18} />
              </Button>
            </div>
          </div>
        </div>
        {filters && (
          <div className="filter-row">
            <label>
              Case type
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="all">All types</option>
                {["Subsale", "SPA", "Loan", "Refinance"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Agent
              <select value={agent} onChange={(e) => setAgent(e.target.value)}>
                <option value="all">All agents</option>
                {w.agents.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="ghost"
              className="text-link"
              onClick={() => {
                setType("all");
                setAgent("all");
                setSearch("");
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
        {board ? (
          <div className="case-board">
            {stages.map((s) => (
              <div className={`board-column tone-${s.tone}`} key={s.id}>
                <div className="board-heading">
                  <span>{s.label}</span>
                  <small>
                    {filtered.filter((c) => c.status === s.id).length}
                  </small>
                </div>
                {filtered
                  .filter((c) => c.status === s.id)
                  .map((c) => (
                    <Button
                      variant="ghost"
                      className="board-card"
                      key={c.id}
                      onClick={() => onOpen(c.id)}
                    >
                      <small>{c.ref}</small>
                      <strong>{c.buyer}</strong>
                      <p>{c.property}</p>
                      <div>
                        <span className={isOverdue(c) ? "overdue" : ""}>
                          {dateLabel(c.due_date)}
                        </span>
                        <Avatar name={c.owner} small />
                      </div>
                    </Button>
                  ))}
                {!filtered.some((c) => c.status === s.id) && (
                  <span className="board-empty">No cases</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <CaseTable cases={filtered} agents={w.agents} onOpen={onOpen} />
        )}
        <div className="table-footer">
          <span>
            {filtered.length} of {w.cases.length} cases
          </span>
          <span>
            {filtered.filter((c) => c.priority === "high").length} high priority
          </span>
        </div>
      </Card>
    </>
  );
}
function TaskLine({
  task: t,
  caseRecord: c,
  onToggle,
  onOpen,
  disabled,
}: {
  task: FollowUp;
  caseRecord?: CaseRecord;
  onToggle: () => void;
  onOpen: () => void;
  disabled?: boolean;
}) {
  return (
    <div className={`task-line ${t.completed ? "task-completed" : ""}`}>
      <Button
        variant="ghost"
        className={`task-checkbox ${t.completed ? "checked" : ""}`}
        aria-label={`${t.completed ? "Reopen" : "Complete"} ${t.title}`}
        disabled={disabled}
        onClick={onToggle}
      >
        {disabled ? (
          <SpinnerGap className="spin" size={13} />
        ) : t.completed ? (
          <Check size={13} weight="bold" />
        ) : null}
      </Button>
      <Button variant="ghost" className="task-line-body" onClick={onOpen}>
        <strong>{t.title}</strong>
        <small>
          {c?.buyer || "General follow-up"}
          <span>·</span>
          <span
            className={!t.completed && t.due_date < today() ? "overdue" : ""}
          >
            {t.due_date === today() ? "Today" : dateLabel(t.due_date)}
          </span>
        </small>
      </Button>
      {t.priority === "high" && (
        <span className="priority-dot" title="High priority" />
      )}
    </div>
  );
}
function FollowupsPage({
  w,
  onEdit,
  onNew,
  toggle,
  busyTask,
  onCase,
}: {
  w: Workspace;
  onEdit: (t: FollowUp) => void;
  onNew: () => void;
  toggle: (t: FollowUp) => void;
  busyTask: string | null;
  onCase: (id: string) => void;
}) {
  const [view, setView] = useState("open");
  const tasks = w.tasks
    .filter(
      (t) =>
        view === "all" ||
        (view === "open" && !t.completed) ||
        (view === "completed" && t.completed),
    )
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  return (
    <>
      <PageHeading
        eyebrow="THE NEXT STEP"
        title="Follow-ups"
        description="Manage upcoming tasks, overdue items and completed follow-ups."
        action={
          <Button
            variant="ghost"
            className="button button-primary"
            onClick={onNew}
          >
            <Plus size={18} />
            New follow-up
          </Button>
        }
      />
      <div className="followup-summary">
        <div>
          <span className="summary-icon amber">
            <Clock size={22} />
          </span>
          <span>
            <strong>
              {
                w.tasks.filter((t) => !t.completed && t.due_date < today())
                  .length
              }
            </strong>
            <small>Overdue</small>
          </span>
        </div>
        <div>
          <span className="summary-icon teal">
            <CalendarBlank size={22} />
          </span>
          <span>
            <strong>
              {
                w.tasks.filter((t) => !t.completed && t.due_date === today())
                  .length
              }
            </strong>
            <small>Due today</small>
          </span>
        </div>
        <div>
          <span className="summary-icon green">
            <CheckCircle size={22} />
          </span>
          <span>
            <strong>{w.tasks.filter((t) => t.completed).length}</strong>
            <small>Completed</small>
          </span>
        </div>
      </div>
      <Card className="panel">
        <div className="case-controls">
          <div className="tabs">
            {["open", "completed", "all"].map((v) => (
              <Button
                variant="ghost"
                className={view === v ? "selected" : ""}
                onClick={() => setView(v)}
                key={v}
              >
                {v === "open"
                  ? "Open follow-ups"
                  : v === "all"
                    ? "All follow-ups"
                    : "Completed"}
              </Button>
            ))}
          </div>
        </div>
        {!tasks.length ? (
          <Empty
            title="Nothing waiting here"
            description="Create a follow-up to keep the next step in sight."
          />
        ) : (
          <div className="followup-list">
            {tasks.map((t) => {
              const c = w.cases.find((c) => c.id === t.case_id);
              return (
                <div className="followup-row" key={t.id}>
                  <TaskLine
                    task={t}
                    caseRecord={c}
                    onToggle={() => toggle(t)}
                    disabled={busyTask === t.id}
                    onOpen={() => onEdit(t)}
                  />
                  <div className="followup-meta">
                    <span className="person">
                      <Avatar name={t.assignee} small />
                      {t.assignee}
                    </span>
                    {c && (
                      <Button
                        variant="ghost"
                        className="text-link"
                        onClick={() => onCase(c.id)}
                      >
                        {c.ref}
                        <ArrowUpRight size={14} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="icon-button"
                      onClick={() => onEdit(t)}
                      aria-label={`Edit ${t.title}`}
                    >
                      <PencilSimple size={17} />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
function AgentsPage({
  w,
  onEdit,
  onNew,
  onCase,
}: {
  w: Workspace;
  onEdit: (a: Agent) => void;
  onNew: () => void;
  onCase: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const agents = w.agents.filter((a) =>
    [a.name, a.agency, a.email].some((x) =>
      x.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  return (
    <>
      <PageHeading
        eyebrow="YOUR NETWORK"
        title="Property agents"
        description="The property agents behind your matters, all in one place."
        action={
          <Button
            variant="ghost"
            className="button button-primary"
            onClick={onNew}
          >
            <Plus size={18} />
            Add agent
          </Button>
        }
      />
      <div className="agents-toolbar">
        <p>
          <strong>{w.agents.length}</strong> agents in your network
        </p>
        <div className="search-input">
          <MagnifyingGlass size={18} />
          <Input
            aria-label="Search agents"
            placeholder="Find an agent or agency…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="agent-grid">
        {agents.map((a) => {
          const cases = w.cases.filter((c) => c.agent_id === a.id),
            active = cases.filter((c) => c.status !== "completed");
          return (
            <article className="agent-card" key={a.id}>
              <div className="agent-card-top">
                <Avatar name={a.name} color={a.color} />
                <Button
                  variant="ghost"
                  className="icon-button"
                  onClick={() => onEdit(a)}
                  aria-label={`Edit ${a.name}`}
                >
                  <PencilSimple size={18} />
                </Button>
              </div>
              <h2>{a.name}</h2>
              <p className="agent-agency">{a.agency || "Independent agent"}</p>
              <div className="agent-contact">
                {a.email && (
                  <a href={`mailto:${a.email}`}>
                    <EnvelopeSimple size={16} />
                    {a.email}
                  </a>
                )}
                {a.phone && (
                  <a href={`tel:${a.phone.replace(/[^+\d]/g, "")}`}>
                    <Phone size={16} />
                    {a.phone}
                  </a>
                )}
              </div>
              <div className="agent-stats">
                <div>
                  <strong>{active.length.toString().padStart(2, "0")}</strong>
                  <span>Active cases</span>
                </div>
                <div>
                  <strong>
                    {cases
                      .filter((c) => c.status === "completed")
                      .length.toString()
                      .padStart(2, "0")}
                  </strong>
                  <span>Completed</span>
                </div>
                <div>
                  <strong>
                    {compactMoney(active.reduce((s, c) => s + c.value, 0))}
                  </strong>
                  <span>Portfolio value</span>
                </div>
              </div>
              <div className="agent-case-list">
                {active.slice(0, 3).map((c) => (
                  <Button
                    variant="ghost"
                    key={c.id}
                    onClick={() => onCase(c.id)}
                  >
                    <span>{c.buyer}</span>
                    <ArrowUpRight size={15} />
                  </Button>
                ))}
                {!active.length && (
                  <p className="muted">No active cases assigned.</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!agents.length && (
        <Empty
          title="No agents found"
          description="Add an agent or try another search."
        />
      )}
    </>
  );
}
function ActivityPage({
  w,
  onCase,
}: {
  w: Workspace;
  onCase: (id: string) => void;
}) {
  const [filter, setFilter] = useState("all");
  const activities = w.activities.filter(
    (a) => filter === "all" || a.kind === filter,
  );
  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE JOURNAL"
        title="Activity log"
        description="Case updates, internal notes and completed next steps."
      />
      <Card className="panel activity-panel">
        <div className="case-controls">
          <div className="tabs">
            {[
              ["all", "All activity"],
              ["status", "Milestones"],
              ["note", "Notes"],
              ["task", "Follow-ups"],
            ].map(([id, label]) => (
              <Button
                variant="ghost"
                className={filter === id ? "selected" : ""}
                key={id}
                onClick={() => setFilter(id)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        <div className="activity-feed">
          {activities.map((a) => {
            const c = w.cases.find((c) => c.id === a.case_id);
            return (
              <article className="activity-event" key={a.id}>
                <span className={`event-icon event-${a.kind}`}>
                  {a.kind === "note" ? (
                    <ChatTeardropText size={18} />
                  ) : a.kind === "task" ? (
                    <CheckSquare size={18} />
                  ) : (
                    <FolderSimple size={18} />
                  )}
                </span>
                <div>
                  <div className="event-top">
                    <h3>{a.title}</h3>
                    <time>
                      {dateLabel(a.created_at)} ·{" "}
                      {new Date(a.created_at).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Kuala_Lumpur",
                      })}
                    </time>
                  </div>
                  <p>{a.detail}</p>
                  <div className="event-bottom">
                    <span>{a.actor}</span>
                    {c && (
                      <Button variant="ghost" onClick={() => onCase(c.id)}>
                        {c.ref} · {c.buyer}
                        <ArrowUpRight size={13} />
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
          {!activities.length && (
            <Empty
              title="Your story starts here"
              description="Updates will appear as your team works on cases."
            />
          )}
        </div>
      </Card>
    </>
  );
}
function SettingsPage({
  w,
  onSave,
}: {
  w: Workspace;
  onSave: (firm: Workspace["firm"]) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const name = String(f.get("name") || "").trim();
      if (!name) throw Error("Enter a workspace name.");
      await onSave({
        ...w.firm,
        name,
        email: String(f.get("email") || "").trim(),
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="MAKE IT YOURS"
        title="Workspace settings"
        description="The details that make this space belong to your firm."
      />
      <div className="settings-grid">
        <Card className="panel settings-panel">
          <SectionTitle
            title="Firm profile"
            subtitle="Shown throughout your workspace"
          />
          <form onSubmit={submit}>
            <label className="field">
              <span>Firm name</span>
              <Input
                name="name"
                defaultValue={w.firm.name}
                required
                maxLength={150}
              />
            </label>
            <label className="field">
              <span>Office email</span>
              <Input
                type="email"
                name="email"
                defaultValue={w.firm.email}
                maxLength={254}
              />
            </label>
            <div className="settings-fixed">
              <div>
                <span>Workspace timezone</span>
                <strong>Asia / Kuala Lumpur</strong>
              </div>
              <div>
                <span>Currency</span>
                <strong>MYR · Malaysian ringgit</strong>
              </div>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button
              variant="ghost"
              className="button button-primary"
              disabled={busy}
            >
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </Card>
        <div className="settings-side">
          <Card className="panel connection-panel">
            <span className="connection-icon">
              <ShieldCheck size={27} />
            </span>
            <h2>Encrypted local workspace</h2>
            <p>
              Records are encrypted before they reach the database. The
              encryption key is stored locally on this computer.
            </p>
            <span className="connection-status live">
              <i /> AES-256-GCM encryption
            </span>
            <p className="connection-note">
              No sign-in is required. Anyone who can use this computer can open
              the workspace. Protect your OS account and backups.
            </p>
          </Card>
          <section className="settings-export">
            <h3>Local backups</h3>
            <p>
              Stop CaseTrack, then copy the entire data folder to a safe
              location. Restore it with the app stopped. Include workspace.key:
              the database cannot be opened without its original key. Keep the
              backup private because it contains both the records and key.
            </p>
            <code>data/casetrack.sqlite</code>
          </section>
          <section className="settings-export">
            <h3>Export your records</h3>
            <p>
              Download a spreadsheet-compatible CSV. Exported files are
              unencrypted; store them carefully.
            </p>
            <Button
              variant="ghost"
              className="button button-secondary"
              onClick={() => downloadCsv(w.cases, w.agents)}
            >
              <Export size={17} />
              Export all cases
            </Button>
          </section>
        </div>
      </div>
    </>
  );
}
function CaseDetail({
  c,
  w,
  onClose,
  onEdit,
  onSave,
  onNote,
  onTask,
}: {
  c: CaseRecord;
  w: Workspace;
  onClose: () => void;
  onEdit: () => void;
  onSave: (c: CaseRecord) => Promise<void>;
  onNote: (note: string) => Promise<void>;
  onTask: (t: FollowUp) => void;
}) {
  const [tab, setTab] = useState("overview"),
    [status, setStatus] = useState(c.status),
    [next, setNext] = useState(c.next_step),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setStatus(c.status);
    setNext(c.next_step);
  }, [c.status, c.next_step]);
  const agent = w.agents.find((a) => a.id === c.agent_id),
    events = w.activities.filter((a) => a.case_id === c.id),
    tasks = w.tasks.filter((t) => t.case_id === c.id);
  async function progress(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!next.trim()) throw Error("Add a next step for this case.");
      await onSave({
        ...c,
        status,
        next_step: next.trim(),
        updated_at: new Date().toISOString(),
      });
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
      title={c.ref}
      description={`${c.type} · Updated ${dateLabel(c.updated_at)}`}
      drawer
    >
      <div className="detail-hero">
        <span className="detail-property-icon">
          <HouseLine size={32} weight="light" />
        </span>
        <h2>{c.buyer}</h2>
        <p>{c.property}</p>
        <div>
          <Badge status={c.status} />
          {c.priority === "high" && (
            <span className="priority-label">
              <WarningCircle size={14} />
              High priority
            </span>
          )}
        </div>
      </div>
      <div className="detail-tabs tabs">
        {[
          ["overview", "Overview"],
          ["timeline", `Timeline (${events.length})`],
        ].map(([id, label]) => (
          <Button
            variant="ghost"
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
        <Button variant="ghost" className="detail-edit" onClick={onEdit}>
          <PencilSimple size={15} />
          Edit case
        </Button>
      </div>
      {tab === "overview" ? (
        <div className="detail-body">
          <div className="detail-facts">
            <div>
              <span>Person in charge</span>
              <strong className="person">
                <Avatar name={c.owner} small />
                {c.owner}
              </strong>
            </div>
            <div>
              <span>Assigned agent</span>
              <AgentName agent={agent} />
            </div>
            <div>
              <span>Target completion</span>
              <strong className={isOverdue(c) ? "overdue" : ""}>
                {dateLabel(c.due_date, true)}
                {isOverdue(c) && " · Overdue"}
              </strong>
            </div>
            <div>
              <span>Property value</span>
              <strong>{money(c.value)}</strong>
            </div>
            <div>
              <span>Seller</span>
              <strong>{c.seller || "Not provided"}</strong>
            </div>
            <div>
              <span>Opened</span>
              <strong>{dateLabel(c.created_at, true)}</strong>
            </div>
          </div>
          <form className="progress-form" onSubmit={progress}>
            <div className="section-heading">
              <h3>Move the matter forward</h3>
              <span className="small-orbit" />
            </div>
            <label className="field">
              <span>Current milestone</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Stage)}
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Next step</span>
              <Textarea
                aria-label="Next step"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                rows={2}
                required
                maxLength={500}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <Button
              variant="ghost"
              className="button button-primary"
              disabled={busy || (status === c.status && next === c.next_step)}
            >
              {busy ? "Saving…" : "Update progress"}
              <ArrowRight size={17} />
            </Button>
          </form>
          {c.notes && (
            <div className="case-context">
              <h3>Case notes</h3>
              <p>{c.notes}</p>
            </div>
          )}
          {tasks.length > 0 && (
            <div className="detail-followups">
              <h3>Related follow-ups</h3>
              {tasks.map((t) => (
                <TaskLine
                  key={t.id}
                  task={t}
                  onToggle={() => onTask(t)}
                  onOpen={() => setTab("timeline")}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="detail-body">
          <form
            className="note-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!note.trim()) return;
              setBusy(true);
              setError("");
              try {
                await onNote(note.trim());
                setNote("");
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              <span>Add an internal note</span>
              <Textarea
                aria-label="Add an internal note"
                rows={3}
                placeholder="Keep your team in the loop…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required
                maxLength={5000}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <Button
              variant="ghost"
              className="button button-primary"
              disabled={busy || !note.trim()}
            >
              {busy ? "Adding…" : "Add note"}
              <Plus size={17} />
            </Button>
          </form>
          <div className="detail-timeline">
            {events.map((a) => (
              <div className="timeline-event" key={a.id}>
                <span />
                <div>
                  <small>
                    {dateLabel(a.created_at)} · {a.actor}
                  </small>
                  <h3>{a.title}</h3>
                  <p>{a.detail}</p>
                </div>
              </div>
            ))}
            {!events.length && (
              <p className="muted">No updates recorded yet.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
