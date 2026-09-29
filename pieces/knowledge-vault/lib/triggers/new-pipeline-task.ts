import { createTrigger, Property, TriggerStrategy } from "@powerhousedao/pieces-framework";
import { driveNodes } from "../agent/pipeline.js";
import { knowledgeVaultAuth } from "../auth.js";
import type { KnowledgeVaultClient } from "../common/client.js";
import { clientFor, type StoreLike } from "../common/context.js";
import { driveProp } from "../common/props.js";

/**
 * Polls the pipeline queue and starts one run per claim task that reaches a
 * phase, e.g. every source queued for extraction. Each item carries the
 * source's id, so the pipeline steps take it through their "Source id"
 * field: {{trigger.payload.source_id}}.
 *
 * Tasks already waiting when the trigger is switched on are not replayed
 * unless asked: a vault with a backlog of 146 queued sources would otherwise
 * start 146 runs at once.
 */

type Task = { id: string; taskType: string; status: string; documentRef?: string | null; target?: string; currentPhase?: string | null; createdAt?: string; updatedAt?: string | null };

const SEEN_KEY = "knowledge-vault:new-pipeline-task:seen";
const MAX_SEEN = 5000;

export type TaskItem = { task_id: string; source_id: string; source_title: string; phase: string; queued_at: string | null; _dedupe_key: string };

async function openTasks(client: KnowledgeVaultClient, drive: string, phase: string): Promise<Task[]> {
  const nodes = await driveNodes(client, drive);
  const queueId = nodes.find((n) => n.documentType === "bai/pipeline-queue")?.id;
  if (!queueId) return [];
  // A task whose source was deleted would start a run that fails on its first read.
  const sources = new Set(nodes.filter((n) => n.documentType === "bai/source").map((n) => n.id));
  const doc = await client.request<{ state?: { global?: { tasks?: Task[] } } }>({ path: `notes/${encodeURIComponent(queueId)}`, query: { drive } });
  return (doc.state?.global?.tasks ?? []).filter((t) => t.taskType === "claim" && t.status === "PENDING" && t.currentPhase === phase && !!t.documentRef && sources.has(t.documentRef));
}

/** A task is new at a phase: the same task at its next phase fires again. */
const seenKey = (t: Task) => `${t.id}@${t.currentPhase ?? ""}`;

export function toItem(t: Task): TaskItem {
  return {
    task_id: t.id,
    source_id: t.documentRef ?? "",
    source_title: t.target ?? "",
    phase: t.currentPhase ?? "",
    queued_at: t.updatedAt ?? t.createdAt ?? null,
    _dedupe_key: seenKey(t),
  };
}

async function readSeen(store: StoreLike): Promise<string[]> {
  const value = await store.get(SEEN_KEY);
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export async function pollTasks(client: KnowledgeVaultClient, store: StoreLike, props: { drive: string; phase: string; per_poll: number }): Promise<TaskItem[]> {
  const tasks = await openTasks(client, props.drive, props.phase);
  const seen = await readSeen(store);
  const known = new Set(seen);
  const fresh = tasks.filter((t) => !known.has(seenKey(t))).slice(0, props.per_poll);
  if (fresh.length) await store.put(SEEN_KEY, [...seen, ...fresh.map(seenKey)].slice(-MAX_SEEN));
  return fresh.map(toItem);
}

/** A default the form shows is not always stored; an unset phase must not silently match nothing. */
export const phaseOf = (v: unknown): string => (typeof v === "string" && v ? v : "create");

const perPoll = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 20) : 3;
};

export const newPipelineTaskTrigger = createTrigger({
  auth: knowledgeVaultAuth,
  name: "new-pipeline-task",
  displayName: "New pipeline task",
  description:
    "Starts a run for each source whose pipeline task reaches a phase, e.g. every source queued for extraction. Map {{trigger.payload.source_id}} into the pipeline steps' Source id field.",
  type: TriggerStrategy.POLLING,
  props: {
    drive: driveProp,
    phase: Property.StaticDropdown({
      displayName: "Phase",
      description: "Fire when a claim task is waiting at this phase",
      required: true,
      defaultValue: "create",
      options: {
        disabled: false,
        options: [
          { label: "create: queued for extraction", value: "create" },
          { label: "reflect: extracted, to connect", value: "reflect" },
          { label: "reweave: connected, to place in MoCs", value: "reweave" },
          { label: "verify: waiting for review", value: "verify" },
        ],
      },
    }),
    include_backlog: Property.Checkbox({
      displayName: "Include tasks already waiting",
      description: "Off: only tasks that reach the phase after the trigger is switched on. On: the backlog too, a few per poll",
      required: false,
      defaultValue: false,
    }),
    per_poll: Property.Number({
      displayName: "Runs per poll",
      description: "At most this many runs start per check (1–20, default 3), so a backlog drains gradually",
      required: false,
      defaultValue: 3,
    }),
  },
  outputSchema: {
    fields: [
      { key: "source_id", label: "Source id" },
      { key: "source_title", label: "Source title" },
      { key: "task_id", label: "Pipeline task id" },
      { key: "phase", label: "Phase" },
      { key: "queued_at", label: "Queued at" },
    ],
  },
  sampleData: { task_id: "7defdf70-…", source_id: "Dp1tm81E…", source_title: "Tech investment", phase: "create", queued_at: "2026-09-28T15:31:00.000Z" },
  async onEnable(context) {
    const p = context.propsValue as { drive: string; phase: string; include_backlog?: boolean };
    // Everything waiting now counts as seen, unless the backlog is wanted.
    if (p.include_backlog) {
      await context.store.put(SEEN_KEY, []);
      return;
    }
    const tasks = await openTasks(clientFor(context.auth), p.drive, phaseOf(p.phase));
    await context.store.put(SEEN_KEY, tasks.map(seenKey).slice(-MAX_SEEN));
  },
  async onDisable(context) {
    await context.store.put(SEEN_KEY, null);
  },
  async run(context) {
    const p = context.propsValue as { drive: string; phase: string; per_poll?: unknown };
    return pollTasks(clientFor(context.auth), context.store as StoreLike, { drive: p.drive, phase: phaseOf(p.phase), per_poll: perPoll(p.per_poll) });
  },
  async test(context) {
    const p = context.propsValue as { drive: string; phase: string };
    const tasks = await openTasks(clientFor(context.auth), p.drive, phaseOf(p.phase));
    return tasks.slice(-1).map(toItem);
  },
});
