import type { PipelineTask } from "document-models/pipeline-queue";

/**
 * How the pipeline queue editor reads a task: which group it belongs to,
 * whether it is still open, and the order that puts what needs a person
 * first. Pure, so the table's behaviour is tested without rendering it.
 */

export type TaskGroup = "review" | "blocked" | "working" | "queued" | "done" | "failed";

export const GROUP_LABEL: Record<TaskGroup, string> = {
  review: "Waiting for review",
  blocked: "Blocked",
  working: "Working",
  queued: "Queued",
  done: "Done",
  failed: "Failed",
};

/** Attention order: what waits on a person, then what is stuck, then routine work, then history. */
const GROUP_RANK: Record<TaskGroup, number> = { review: 0, blocked: 1, working: 2, queued: 3, failed: 4, done: 5 };

export const DEFAULT_PHASES = ["create", "reflect", "reweave", "verify"];

export function groupOf(task: Pick<PipelineTask, "status" | "currentPhase">): TaskGroup {
  switch (task.status) {
    case "DONE":
      return "done";
    case "FAILED":
      return "failed";
    case "BLOCKED":
      return "blocked";
    default:
      if (task.currentPhase === "verify") return "review";
      return task.status === "IN_PROGRESS" ? "working" : "queued";
  }
}

export const isOpen = (task: Pick<PipelineTask, "status" | "currentPhase">) => {
  const g = groupOf(task);
  return g !== "done" && g !== "failed";
};

export type View = "open" | "review" | "problems" | "finished" | "all";

export const VIEW_LABEL: Record<View, string> = {
  open: "Open",
  review: "Needs review",
  problems: "Blocked & failed",
  finished: "Finished",
  all: "All",
};

export function inView(task: Pick<PipelineTask, "status" | "currentPhase">, view: View): boolean {
  const g = groupOf(task);
  switch (view) {
    case "open":
      return isOpen(task);
    case "review":
      return g === "review";
    case "problems":
      return g === "blocked" || g === "failed";
    case "finished":
      return g === "done" || g === "failed";
    case "all":
      return true;
  }
}

export type Filters = { view: View; phase: string | null; query: string };

export function filterTasks<T extends Pick<PipelineTask, "status" | "currentPhase" | "target" | "assignedTo">>(tasks: T[], f: Filters): T[] {
  const q = f.query.trim().toLowerCase();
  return tasks.filter((t) => {
    if (!inView(t, f.view)) return false;
    if (f.phase && t.currentPhase !== f.phase) return false;
    if (q && !`${t.target} ${t.assignedTo ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

const when = (t: Pick<PipelineTask, "updatedAt" | "createdAt">) => Date.parse(t.updatedAt ?? t.createdAt) || 0;

/** What needs a person first; within a group, the most recently touched. Stable for equal keys. */
export function sortTasks<T extends Pick<PipelineTask, "status" | "currentPhase" | "updatedAt" | "createdAt">>(tasks: T[]): T[] {
  return tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => GROUP_RANK[groupOf(a.t)] - GROUP_RANK[groupOf(b.t)] || when(b.t) - when(a.t) || a.i - b.i)
    .map(({ t }) => t);
}

export function countGroups(tasks: Pick<PipelineTask, "status" | "currentPhase">[]): Record<TaskGroup, number> {
  const out: Record<TaskGroup, number> = { review: 0, blocked: 0, working: 0, queued: 0, done: 0, failed: 0 };
  for (const t of tasks) out[groupOf(t)]++;
  return out;
}

/** Open tasks per phase, for the flow strip. */
export function openByPhase(tasks: Pick<PipelineTask, "status" | "currentPhase">[], phases: string[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(phases.map((p) => [p, 0]));
  for (const t of tasks) if (isOpen(t) && t.currentPhase && t.currentPhase in out) out[t.currentPhase]++;
  return out;
}

/** The claim pipeline's phases from the queue's own phase order; the default when it has none. */
export function claimPhases(phaseOrder: { taskType: string; phases: string[] }[] | null | undefined): string[] {
  const claim = (phaseOrder ?? []).find((p) => p.taskType === "claim");
  return claim?.phases.length ? claim.phases : DEFAULT_PHASES;
}

export type PhaseState = "done" | "current" | "upcoming" | "stopped";

/** Each phase of a task: finished, where it is, still to come, or where it stopped. */
export function phaseStates(task: Pick<PipelineTask, "status" | "currentPhase" | "completedPhases">, phases: string[]): PhaseState[] {
  const done = new Set(task.completedPhases);
  const stopped = task.status === "FAILED" || task.status === "BLOCKED";
  return phases.map((p) => {
    if (done.has(p)) return "done";
    if (p === task.currentPhase) return stopped ? "stopped" : "current";
    if (task.status === "DONE") return "done";
    return "upcoming";
  });
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "12 d ago", then a date. */
export function relativeTime(iso: string | null | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172_800) return "yesterday";
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return new Date(t).toISOString().slice(0, 10);
}
