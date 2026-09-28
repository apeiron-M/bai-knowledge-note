import { randomUUID } from "node:crypto";
import type { KnowledgeVaultClient } from "../common/client.js";
import { errorMessage } from "../common/errors.js";

/**
 * The pipeline queue's side of a job: the claim task for a source moves
 * create → reflect → reweave → verify, one handoff per phase. Each job
 * advances only from the phase it owns, so running a step twice, or out of
 * order, never skips a phase. Verify is left to a person: its advance
 * completes the task, and approving notes is a reviewer's decision.
 */

type DriveNode = { id: string; documentType?: string | null };
type Task = { id: string; status: string; documentRef?: string | null; currentPhase?: string | null; assignedTo?: string | null; taskType: string };
export type PipelinePhase = "create" | "reflect" | "reweave";

export type PipelineResult = { task_id: string | null; from: string | null; to: string | null; summary: string };

export async function findQueue(client: KnowledgeVaultClient, drive: string): Promise<string | null> {
  const doc = await client.request<{ state?: { global?: { nodes?: DriveNode[] } } }>({ path: `notes/${encodeURIComponent(drive)}`, query: { drive } });
  return doc.state?.global?.nodes?.find((n) => n.documentType === "bai/pipeline-queue")?.id ?? null;
}

async function taskFor(client: KnowledgeVaultClient, drive: string, queueId: string, sourceId: string): Promise<Task | null> {
  const doc = await client.request<{ state?: { global?: { tasks?: Task[] } } }>({ path: `notes/${encodeURIComponent(queueId)}`, query: { drive } });
  const open = (doc.state?.global?.tasks ?? []).filter((t) => t.documentRef === sourceId && (t.status === "PENDING" || t.status === "IN_PROGRESS"));
  return open.at(-1) ?? null;
}

/** Advance the source's task past `phase`, when that is where it stands. Never throws: the job's work is done either way. */
export async function advancePipeline(
  client: KnowledgeVaultClient,
  args: { drive: string; sourceId: string; phase: PipelinePhase; workDone: string; filesModified: string[]; completedBy: string; now?: () => Date },
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
    if (task.status === "PENDING") {
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
    const next = { create: "reflect", reflect: "reweave", reweave: "verify" }[args.phase];
    return { task_id: task.id, from: args.phase, to: next, summary: `Pipeline task advanced ${args.phase} → ${next}.` };
  } catch (error) {
    return none(`The pipeline task could not be updated: ${errorMessage(error)}`);
  }
}
