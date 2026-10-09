import { randomUUID } from "node:crypto";
import type { KnowledgeVaultClient } from "../common/client.js";
import { errorMessage, KnowledgeVaultApiError } from "../common/errors.js";

/**
 * The pipeline queue's side of a job: the claim task for a source moves
 * create → reflect → reweave → verify, one handoff per phase. Each job
 * advances only from the phase it owns, so running a step twice, or out of
 * order, never skips a phase. The Verify step's advance completes the task;
 * approving the notes stays a reviewer's decision, on the notes themselves.
 *
 * When a report was lost (a run cut off, an advance refused, a step run on
 * its own), the queue lags the vault. `catchUp` asks the vault to move the
 * task past every phase it can prove from what it holds
 * (POST tasks/reconcile); a step whose phase is then behind the task passes
 * through instead of redoing the work.
 */

type DriveNode = { id: string; documentType?: string | null };
type Task = { id: string; status: string; documentRef?: string | null; currentPhase?: string | null; assignedTo?: string | null; taskType: string };
export type PipelinePhase = "create" | "reflect" | "reweave" | "verify";
export const PIPELINE_PHASES: readonly PipelinePhase[] = ["create", "reflect", "reweave", "verify"];

export type PipelineResult = { task_id: string | null; from: string | null; to: string | null; summary: string };

export async function driveNodes(client: KnowledgeVaultClient, drive: string): Promise<DriveNode[]> {
  const doc = await client.request<{ state?: { global?: { nodes?: DriveNode[] } } }>({ path: `notes/${encodeURIComponent(drive)}`, query: { drive } });
  return doc.state?.global?.nodes ?? [];
}

export async function findQueue(client: KnowledgeVaultClient, drive: string): Promise<string | null> {
  return (await driveNodes(client, drive)).find((n) => n.documentType === "bai/pipeline-queue")?.id ?? null;
}

const sameAddress = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Where the source's task stands against a step's phase, read-only:
 * `at` (the step's own phase), `ahead` (the task is already past it),
 * `behind` (an earlier phase is still open), `done` (no open task, a
 * finished one), `none` (no task: the step was run by hand) or
 * `unknown` (no queue, or a phase this step does not know).
 */
export type TaskPosition = { task_id: string | null; position: "at" | "ahead" | "behind" | "done" | "none" | "unknown"; phase: string | null; status: string | null; assignedTo: string | null };

export async function taskPosition(client: KnowledgeVaultClient, args: { drive: string; sourceId: string; phase: PipelinePhase }): Promise<TaskPosition> {
  const queueId = await findQueue(client, args.drive);
  if (!queueId) return { task_id: null, position: "unknown", phase: null, status: null, assignedTo: null };
  const tasks = await sourceTasks(client, args.drive, queueId, args.sourceId);
  const open = tasks.filter((t) => t.status === "PENDING" || t.status === "IN_PROGRESS").at(-1);
  if (!open) {
    const done = tasks.filter((t) => t.status === "DONE").at(-1);
    return done ? { task_id: done.id, position: "done", phase: null, status: "DONE", assignedTo: null } : { task_id: null, position: "none", phase: null, status: null, assignedTo: null };
  }
  const here = PIPELINE_PHASES.indexOf(args.phase);
  const there = PIPELINE_PHASES.indexOf((open.currentPhase ?? "") as PipelinePhase);
  const position = there < 0 ? "unknown" : there === here ? "at" : there > here ? "ahead" : "behind";
  return { task_id: open.id, position, phase: open.currentPhase ?? null, status: open.status, assignedTo: open.assignedTo ?? null };
}

export type CatchUpResult = { summary: string; advanced: { taskId: string; phases: string[]; to: string }[] };

/**
 * Ask the vault to move this source's pipeline task past every phase its
 * notes, links and MoC places already prove. Never throws: a vault that
 * predates the route, or a refusal, is reported and the step goes on.
 */
export async function catchUp(client: KnowledgeVaultClient, args: { drive: string; sourceId: string; by: string }): Promise<CatchUpResult> {
  try {
    const out = await client.request<{ advanced?: { taskId: string; phases: string[]; to: string; status?: string | null; phase?: string | null }[]; sources?: { addedClaims: number; closed: boolean }[]; left?: { reason: string }[] }>({
      method: "POST",
      path: "tasks/reconcile",
      json: { drive: args.drive, source: args.sourceId, by: args.by },
    });
    const advanced = (out.advanced ?? []).map((a) => ({ taskId: a.taskId, phases: a.phases, to: a.status === "DONE" ? "done" : (a.phase ?? a.to) }));
    const repaired = (out.sources ?? []).length ? " The source was brought up to date with its notes." : "";
    if (advanced.length) return { summary: `Caught the pipeline task up from the vault: ${advanced.map((a) => `${a.phases.join(", ")} recorded, now ${a.to === "done" ? "complete" : `at ${a.to}`}`).join("; ")}.${repaired}`, advanced };
    const why = out.left?.[0]?.reason;
    return { summary: `The pipeline task already matches the vault${why ? ` (${why})` : ""}.${repaired}`, advanced };
  } catch (error) {
    const message = errorMessage(error);
    const missingRoute = (error instanceof KnowledgeVaultApiError && error.status === 404) || /^no route/i.test(message);
    if (missingRoute && !/pipeline queue/i.test(message)) {
      return { summary: "This vault cannot catch the pipeline up (its Switchboard predates tasks/reconcile).", advanced: [] };
    }
    return { summary: `The pipeline task could not be caught up: ${message}`, advanced: [] };
  }
}

/** What a step says when the queue shows its phase is already done. */
export function passThrough(position: TaskPosition, phase: PipelinePhase): string {
  return position.position === "done"
    ? `The source's pipeline task is already complete; ${phase} has nothing left to do.`
    : `The source's pipeline task is already past ${phase} (at ${position.phase}); this step has nothing left to do.`;
}

function describePosition(position: TaskPosition, phase: PipelinePhase): string {
  switch (position.position) {
    case "at":
      return `The pipeline task is at ${phase}.`;
    case "behind":
      return `The pipeline task is still at ${position.phase}; this step runs and leaves it there.`;
    case "done":
      return "The source's pipeline task is already complete; this step runs on its own.";
    case "none":
      return "This source has no pipeline task; this step runs on its own.";
    default:
      return position.phase ? `The pipeline task is at "${position.phase}", which this step does not know.` : "No pipeline queue in this vault.";
  }
}

/**
 * Before a step's work: a task still behind the step's phase is caught up
 * from the vault first, and a task already past it makes the step pass
 * through, so a resumed run never redoes what is done. Read-only otherwise:
 * claiming stays with claimPhase.
 */
export async function gateStep(client: KnowledgeVaultClient, args: { drive: string; sourceId: string; phase: PipelinePhase; by: string }): Promise<{ skip: boolean; position: TaskPosition; summary: string }> {
  let position = await taskPosition(client, args);
  let caught = "";
  if (position.position === "behind") {
    caught = `${(await catchUp(client, args)).summary} `;
    position = await taskPosition(client, args);
  }
  if (position.position === "ahead") return { skip: true, position, summary: `${caught}${passThrough(position, args.phase)}` };
  return { skip: false, position, summary: `${caught}${describePosition(position, args.phase)}` };
}

/**
 * Take the source's task for a phase before any work, so nobody else starts
 * on it meanwhile: a PENDING task at the phase is claimed; one already held
 * by this identity (a rerun) is kept; one held by someone else stops the
 * step. No task, or a task at another phase, is left alone: the step still
 * runs, and advancePipeline says why it did not advance.
 */
export async function claimPhase(client: KnowledgeVaultClient, args: { drive: string; sourceId: string; phase: PipelinePhase }): Promise<{ task_id: string | null; summary: string }> {
  const queueId = await findQueue(client, args.drive);
  if (!queueId) return { task_id: null, summary: "No pipeline queue in this vault." };
  const task = await taskFor(client, args.drive, queueId, args.sourceId);
  if (!task) return { task_id: null, summary: "This source has no open pipeline task." };
  if (task.currentPhase !== args.phase) return { task_id: task.id, summary: `The pipeline task is at "${task.currentPhase}", not "${args.phase}"; it is left alone.` };
  const { user } = await client.request<{ user: string | null }>({ path: "ping" });
  if (task.status === "IN_PROGRESS") {
    if (sameAddress(task.assignedTo, user)) return { task_id: task.id, summary: `The pipeline task at ${args.phase} is already held by this connection (a rerun).` };
    throw new KnowledgeVaultApiError(`The source's pipeline task at ${args.phase} is being worked by ${task.assignedTo ?? "someone else"}; this step stops so the work is not done twice.`, { category: "validation" });
  }
  await client.request({ method: "POST", path: `tasks/${encodeURIComponent(task.id)}/claim`, query: { drive: args.drive }, json: {} });
  return { task_id: task.id, summary: `Claimed the pipeline task at ${args.phase}.` };
}

async function sourceTasks(client: KnowledgeVaultClient, drive: string, queueId: string, sourceId: string): Promise<Task[]> {
  const doc = await client.request<{ state?: { global?: { tasks?: Task[] } } }>({ path: `notes/${encodeURIComponent(queueId)}`, query: { drive } });
  return (doc.state?.global?.tasks ?? []).filter((t) => t.documentRef === sourceId);
}

async function taskFor(client: KnowledgeVaultClient, drive: string, queueId: string, sourceId: string): Promise<Task | null> {
  const open = (await sourceTasks(client, drive, queueId, sourceId)).filter((t) => t.status === "PENDING" || t.status === "IN_PROGRESS");
  return open.at(-1) ?? null;
}

/** Advance the source's task past `phase`, when that is where it stands. Never throws: the job's work is done either way. */
export async function advancePipeline(
  client: KnowledgeVaultClient,
  args: {
    drive: string;
    sourceId: string;
    phase: PipelinePhase;
    workDone: string;
    filesModified: string[];
    completedBy: string;
    /** Why the phase's work did not land, when it did not: the task then stays where it is. */
    incomplete?: string | null;
    now?: () => Date;
  },
): Promise<PipelineResult> {
  const none = (summary: string): PipelineResult => ({ task_id: null, from: null, to: null, summary });
  try {
    const queueId = await findQueue(client, args.drive);
    if (!queueId) return none("No pipeline queue in this vault; nothing to advance.");
    const task = await taskFor(client, args.drive, queueId, args.sourceId);
    if (!task) return none("This source has no open pipeline task; nothing to advance.");
    if (task.currentPhase !== args.phase) {
      return { task_id: task.id, from: task.currentPhase ?? null, to: task.currentPhase ?? null, summary: `The pipeline task is at "${task.currentPhase}", not "${args.phase}"; left as it is.` };
    }
    if (args.incomplete) {
      return { task_id: task.id, from: args.phase, to: args.phase, summary: `The pipeline task stays at ${args.phase}: ${args.incomplete}. Fix that and run the step again.` };
    }
    if (task.status === "IN_PROGRESS") {
      const { user } = await client.request<{ user: string | null }>({ path: "ping" });
      if (!sameAddress(task.assignedTo, user)) {
        return { task_id: task.id, from: args.phase, to: args.phase, summary: `The pipeline task is held by ${task.assignedTo ?? "someone else"}, not this connection; left as it is.` };
      }
    } else {
      await client.request({ method: "POST", path: `tasks/${encodeURIComponent(task.id)}/claim`, query: { drive: args.drive }, json: {} });
    }
    const at = (args.now ?? (() => new Date()))().toISOString();
    const result = await client.request<{ operations: { type: string; error?: string | null }[] }>({
      method: "POST",
      path: "actions",
      json: {
        documentId: queueId,
        actions: [{ type: "ADVANCE_PHASE", input: { taskId: task.id, handoff: { id: randomUUID(), phase: args.phase, workDone: args.workDone, filesModified: args.filesModified, completedAt: at, completedBy: args.completedBy }, updatedAt: at } }],
      },
    });
    const failed = result.operations.find((o) => o.error);
    if (failed) return { task_id: task.id, from: args.phase, to: args.phase, summary: `The pipeline task did not advance: ${failed.error}` };
    if (args.phase === "verify") return { task_id: task.id, from: "verify", to: "done", summary: "Pipeline task complete: verify was the last phase." };
    const next = { create: "reflect", reflect: "reweave", reweave: "verify" }[args.phase];
    return { task_id: task.id, from: args.phase, to: next, summary: `Pipeline task advanced ${args.phase} → ${next}.` };
  } catch (error) {
    return none(`The pipeline task could not be updated: ${errorMessage(error)}`);
  }
}
