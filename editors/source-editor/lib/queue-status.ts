import type { PipelineTask } from "document-models/pipeline-queue";

/**
 * What the source editor says about a source's place in the processing queue. Read from the queue's own task
 * (not a local flag), so it is right after a reload and for sources queued anywhere. Pure, so it is tested
 * without rendering the editor.
 */

/** On the web, a source still waiting at the first phase with no handoff this long after it was queued is called out. */
export const STUCK_AFTER_MS = 600_000;

export type QueueTask = Pick<PipelineTask, "taskType" | "status" | "currentPhase" | "documentRef" | "createdAt" | "handoffs">;

const OPEN = new Set<string>(["PENDING", "IN_PROGRESS", "BLOCKED"]);

const PHASE_WORDS: Record<string, string> = {
  create: "extracting notes",
  reflect: "connecting notes",
  reweave: "placing notes in topics",
  verify: "checking notes",
};

const queuedAt = (t: Pick<QueueTask, "createdAt">) => Date.parse(t.createdAt) || 0;

/** The source's newest open claim task (PENDING, IN_PROGRESS or BLOCKED); an old failed one never counts. */
export function openTaskFor<T extends QueueTask>(tasks: readonly T[], sourceId: string): T | undefined {
  let best: T | undefined;
  for (const t of tasks) {
    if (t.documentRef !== sourceId || t.taskType !== "claim" || !OPEN.has(t.status)) continue;
    if (!best || queuedAt(t) > queuedAt(best)) best = t;
  }
  return best;
}

/** The line under the source's actions, or null when nothing is open. */
export function queueStatusLine(task: QueueTask | undefined, opts: { desktop: boolean; now: number }): string | null {
  if (!task) return null;
  if (task.status === "BLOCKED") return "Processing is blocked — see Processing queue";
  const atCreate = !task.currentPhase || task.currentPhase === "create";
  if (task.status === "PENDING" && atCreate) {
    if (opts.desktop) return "Queued — the app processes it in the background";
    const stuck = task.handoffs.length === 0 && opts.now - queuedAt(task) >= STUCK_AFTER_MS;
    return stuck
      ? "Queued for processing — nothing has started it yet. If this vault's server does not process sources, run /powerhouse-knowledge:pipeline in Claude Code."
      : "Queued for processing";
  }
  const words = task.currentPhase ? PHASE_WORDS[task.currentPhase] : undefined;
  return words ? `Processing — ${words}` : "Processing";
}
