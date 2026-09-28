import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { useSelectedPipelineQueueDocument } from "document-models/pipeline-queue";
import { useMemo, useState } from "react";
import { TOOLBAR_CLASS } from "../shared/theme-context.js";
import { PhaseFlow } from "./components/phase-flow.js";
import { TaskTable } from "./components/task-table.js";
import { claimPhases, countGroups, filterTasks, inView, openByPhase, sortTasks, VIEW_LABEL, type View } from "./lib/tasks.js";
import { PIPELINE_QUEUE_STYLES } from "./styles.js";

const VIEWS: View[] = ["open", "review", "problems", "finished", "all"];

const EMPTY: Record<View, string> = {
  open: "Nothing is waiting. Queue a source in the vault and it shows up here.",
  review: "No source is waiting for review.",
  problems: "No task is blocked or failed.",
  finished: "No task has finished yet.",
  all: "The queue is empty. Queue a source in the vault to start the pipeline.",
};

export default function Editor() {
  const [document] = useSelectedPipelineQueueDocument();
  const state = document.state.global;
  const tasks = state.tasks;
  const phases = useMemo(() => claimPhases(state.phaseOrder), [state.phaseOrder]);
  const [view, setView] = useState<View>("open");
  const [phase, setPhase] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const now = Date.now();

  const groups = useMemo(() => countGroups(tasks), [tasks]);
  const byPhase = useMemo(() => openByPhase(tasks, phases), [tasks, phases]);
  const viewCounts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v, tasks.filter((t) => inView(t, v)).length])) as Record<View, number>, [tasks]);
  const visible = useMemo(() => sortTasks(filterTasks(tasks, { view, phase, query })), [tasks, view, phase, query]);

  const open = groups.review + groups.blocked + groups.working + groups.queued;
  const summary = [
    groups.review ? `${groups.review} waiting for your review` : null,
    groups.blocked ? `${groups.blocked} blocked` : null,
    groups.working ? `${groups.working} working` : null,
    groups.queued ? `${groups.queued} queued` : null,
  ].filter(Boolean);

  const selectPhase = (p: string | null) => {
    setPhase(p);
    // A phase holds open tasks; looking at one from the Finished view would show nothing.
    if (p && (view === "finished" || view === "problems")) setView("open");
  };

  return (
    <div className="pq-editor min-h-screen" style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}>
      <style>{PIPELINE_QUEUE_STYLES}</style>
      <div className="mx-auto max-w-6xl">
        <DocumentToolbar toolbarClassName={TOOLBAR_CLASS} />
        <div className="pq-body">
          <header className="pq-head">
            <h1>Processing pipeline</h1>
            <p className="pq-summary">
              {open === 0 ? "Nothing in progress." : `${summary.join(", ")}.`}{" "}
              <span className="pq-muted">
                {groups.done} done, {groups.failed} failed
                {state.lastProcessedAt ? `, last change ${new Date(state.lastProcessedAt).toLocaleString()}` : ""}.
              </span>
            </p>
          </header>

          <PhaseFlow phases={phases} counts={byPhase} active={phase} onSelect={selectPhase} />

          <section className="pq-panel" aria-label="Tasks">
            <div className="pq-controls">
              <div className="pq-tabs" role="tablist" aria-label="Which tasks">
                {VIEWS.map((v) => (
                  <button key={v} type="button" role="tab" aria-selected={view === v} className={`pq-tab${view === v ? " is-selected" : ""}`} onClick={() => setView(v)}>
                    {VIEW_LABEL[v]} <span className="pq-tab-count">{viewCounts[v]}</span>
                  </button>
                ))}
              </div>
              <label className="pq-search">
                <span className="sr-only">Find a source</span>
                <input type="search" placeholder="Find a source" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
            </div>
            {phase && (
              <p className="pq-filter-note">
                At <strong>{phase}</strong> only.{" "}
                <button type="button" className="pq-link" onClick={() => setPhase(null)}>
                  Show every phase
                </button>
              </p>
            )}
            <TaskTable tasks={visible} phases={phases} now={now} emptyText={query ? `No source matches "${query}".` : EMPTY[view]} />
          </section>
        </div>
      </div>
    </div>
  );
}
