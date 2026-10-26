import { createTrigger, Property, TriggerStrategy } from "@powerhousedao/pieces-framework";
import { driveNodes } from "../agent/pipeline.js";
import { KNOWLEDGE_LINKS } from "../agent/reweave.js";
import { knowledgeVaultAuth } from "../auth.js";
import type { KnowledgeVaultClient } from "../common/client.js";
import { clientFor, type StoreLike } from "../common/context.js";
import { driveProp } from "../common/props.js";
import { HELD_TOO_LONG_MS } from "./new-pipeline-task.js";

/**
 * Polls the vault for notes the pipeline left unwoven and starts one run per
 * check for a few of them, oldest first, while the pipeline is idle. Which
 * notes: what the vault's health report flags, counted as it counts them
 * (notes nothing links to, notes with fewer than 2 links of their own) plus
 * notes no MoC holds, which is how the Reweave notes workflow keeps the vault
 * healthy; or the graph's orphans (in no MoC, nothing links to them); or those
 * and also notes with no links of their own.
 *
 * The pipeline runs each source once. A note extracted before its neighbours
 * existed — the first section of a long report, connected while the vault
 * held nothing like it — or one a run cut off between its steps left behind
 * stays alone for good; Reweave notes gives it a second pass.
 *
 * Paced so a note nothing fits does not cost a model call every check: a
 * note is tried again only an hour later and once the vault holds
 * RETRY_GROWTH more notes than at the last try (something new to link it
 * to), at most MAX_TRIES times. Switching the trigger off and on starts over.
 */

type Task = { taskType: string; status: string; createdAt?: string; updatedAt?: string | null };
type Row = { documentId?: string; title?: string; status?: string; documentType?: string; createdAt?: string | null };
type Edge = { sourceDocumentId: string; targetDocumentId: string; linkType: string };

/** A note younger than this may still be on its way through the pipeline, or not in the graph index yet. */
export const SETTLE_MS = 10 * 60_000;
/** The pipeline counts as at work while a pending task was touched this recently: its notes are still being woven, and it has the model. */
export const PIPELINE_QUIET_MS = 30 * 60_000;
/** A note tried before waits at least this long... */
export const RETRY_AFTER_MS = 60 * 60_000;
/** ...and for the vault to hold this many more notes than at its last try. */
export const RETRY_GROWTH = 5;
/** Tries per note, the first included. */
export const MAX_TRIES = 3;
const TRIED_KEY = "knowledge-vault:unwoven-notes:tried";
type Tried = Partial<Record<string, { n: number; at: number; size: number }>>;

export type UnwovenNote = { id: string; title: string; why: string; createdAt: string | null };
export type UnwovenItem = { note_ids: string; count: number; notes: { id: string; title: string; why: string }[]; _dedupe_key: string };

const touchedAt = (t: Task) => Date.parse(t.updatedAt ?? t.createdAt ?? "");
const isNote = (r: Row) => (r.documentType ?? "bai/knowledge-note") === "bai/knowledge-note" && r.status !== "ARCHIVED" && r.status !== "MOC";

/** True while the pipeline is working on a source: a task held by a run, or one waiting that was touched lately. */
async function pipelineBusy(client: KnowledgeVaultClient, drive: string, t0: number): Promise<boolean> {
  const queueId = (await driveNodes(client, drive)).find((n) => n.documentType === "bai/pipeline-queue")?.id;
  if (!queueId) return false;
  const doc = await client.request<{ state?: { global?: { tasks?: Task[] } } }>({ path: `notes/${encodeURIComponent(queueId)}`, query: { drive } });
  return (doc.state?.global?.tasks ?? []).some(
    (t) => t.taskType === "claim" && ((t.status === "IN_PROGRESS" && t0 - touchedAt(t) < HELD_TOO_LONG_MS) || (t.status === "PENDING" && t0 - touchedAt(t) < PIPELINE_QUIET_MS)),
  );
}

/** The graph's orphans among the notes (nothing links to them, so no MoC holds them either), and how many notes the vault has. */
async function orphanNotes(client: KnowledgeVaultClient, drive: string): Promise<{ notes: UnwovenNote[]; size: number }> {
  const [rows, stats] = await Promise.all([
    client.request<Row[] | { orphans?: Row[] }>({ path: "orphans", query: { drive } }),
    client.request<{ noteCount?: number }>({ path: "stats", query: { drive } }).catch(() => ({ noteCount: 0 })),
  ]);
  const list = Array.isArray(rows) ? rows : (rows.orphans ?? []);
  return {
    notes: list.filter((r) => r.documentId && isNote(r)).map((r) => ({ id: r.documentId as string, title: r.title ?? (r.documentId as string), why: "in no MoC, and nothing links to it", createdAt: r.createdAt ?? null })),
    size: stats.noteCount ?? 0,
  };
}

/** Every note no MoC holds or with no links of its own, read from the whole graph. */
async function unwovenFromGraph(client: KnowledgeVaultClient, drive: string): Promise<{ notes: UnwovenNote[]; size: number }> {
  const graph = await client.request<{ nodes: Row[]; edges: Edge[] }>({ path: "graph.json", query: { drive }, timeoutMs: 60_000 });
  const notes = graph.nodes.filter((n) => n.documentId && n.documentType === "bai/knowledge-note" && isNote(n));
  const held = new Set(graph.edges.filter((e) => e.linkType === "CORE_IDEA").map((e) => e.targetDocumentId));
  const linked = new Set(graph.edges.filter((e) => KNOWLEDGE_LINKS.has(e.linkType)).flatMap((e) => [e.sourceDocumentId, e.targetDocumentId]));
  const out: UnwovenNote[] = [];
  for (const n of notes) {
    const id = n.documentId as string;
    const why = !held.has(id) && !linked.has(id) ? "in no MoC, with no links" : !held.has(id) ? "in no MoC" : !linked.has(id) ? "no links to other notes" : null;
    if (why) out.push({ id, title: n.title ?? id, why, createdAt: n.createdAt ?? null });
  }
  return { notes: out, size: notes.length };
}

/**
 * What the vault's health report flags, counted as health-checks.ts counts it: a note no other note links to (an
 * orphan; a MoC holding it does not count), a note with fewer than 2 links to other notes, and a note no MoC holds,
 * which Reweave places. Repairing exactly these is what moves the report.
 */
async function healthFlagged(client: KnowledgeVaultClient, drive: string): Promise<{ notes: UnwovenNote[]; size: number }> {
  const graph = await client.request<{ nodes: Row[]; edges: Edge[] }>({ path: "graph.json", query: { drive }, timeoutMs: 60_000 });
  const notes = graph.nodes.filter((n) => n.documentId && n.documentType === "bai/knowledge-note" && isNote(n));
  const ids = new Set(notes.map((n) => n.documentId as string));
  const held = new Set(graph.edges.filter((e) => e.linkType === "CORE_IDEA").map((e) => e.targetDocumentId));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const e of graph.edges) {
    if (!KNOWLEDGE_LINKS.has(e.linkType) || !ids.has(e.sourceDocumentId) || !ids.has(e.targetDocumentId)) continue;
    outgoing.set(e.sourceDocumentId, (outgoing.get(e.sourceDocumentId) ?? 0) + 1);
    incoming.set(e.targetDocumentId, (incoming.get(e.targetDocumentId) ?? 0) + 1);
  }
  const out: UnwovenNote[] = [];
  for (const n of notes) {
    const id = n.documentId as string;
    const why = [
      ...(incoming.get(id) ? [] : ["nothing links to it"]),
      ...((outgoing.get(id) ?? 0) < 2 ? ["fewer than 2 links of its own"] : []),
      ...(held.has(id) ? [] : ["in no MoC"]),
    ];
    if (why.length) out.push({ id, title: n.title ?? id, why: why.join("; "), createdAt: n.createdAt ?? null });
  }
  return { notes: out, size: notes.length };
}

/** Which notes a check takes: what the health report flags, the graph's orphans, or those and notes with no links. */
export type Selection = "health" | "orphans" | "unlinked";
export function selectionOf(p: { select?: unknown; include_unlinked?: unknown }): Selection {
  if (p.select === "health" || p.select === "orphans" || p.select === "unlinked") return p.select;
  // A workflow set up before the choice keeps what its checkbox said.
  return p.include_unlinked === true ? "unlinked" : "orphans";
}

/** The notes a check would pick up now, oldest first, before the tries are counted. */
export async function findUnwoven(client: KnowledgeVaultClient, props: { drive: string; select: Selection }, t0: number) {
  const found =
    props.select === "health" ? await healthFlagged(client, props.drive) : props.select === "unlinked" ? await unwovenFromGraph(client, props.drive) : await orphanNotes(client, props.drive);
  const settled = found.notes.filter((n) => !(t0 - Date.parse(n.createdAt ?? "") < SETTLE_MS));
  settled.sort((a, b) => (Date.parse(a.createdAt ?? "") || 0) - (Date.parse(b.createdAt ?? "") || 0));
  return { notes: settled, size: found.size };
}

async function readTried(store: StoreLike): Promise<Tried> {
  const value = await store.get(TRIED_KEY);
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Tried = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const r = v as { n?: unknown; at?: unknown; size?: unknown } | null;
    if (r && typeof r.n === "number" && typeof r.at === "number" && typeof r.size === "number") out[k] = { n: r.n, at: r.at, size: r.size };
  }
  return out;
}

export async function pollUnwoven(
  client: KnowledgeVaultClient,
  store: StoreLike,
  props: { drive: string; batch: number; select: Selection },
  now: () => number = Date.now,
): Promise<UnwovenItem[]> {
  const t0 = now();
  if (await pipelineBusy(client, props.drive, t0)) return [];
  const { notes, size } = await findUnwoven(client, props, t0);
  const tried = await readTried(store);
  const due = notes.filter((n) => {
    const t = tried[n.id];
    return !t || (t.n < MAX_TRIES && t0 - t.at >= RETRY_AFTER_MS && size >= t.size + RETRY_GROWTH);
  });
  const picked = due.slice(0, props.batch);
  // Notes woven since (or deleted) leave the record: it holds only what is still unwoven.
  const still = new Set(notes.map((n) => n.id));
  const next: Tried = Object.fromEntries(Object.entries(tried).filter(([id]) => still.has(id)));
  for (const n of picked) next[n.id] = { n: (tried[n.id]?.n ?? 0) + 1, at: t0, size };
  await store.put(TRIED_KEY, next);
  if (picked.length === 0) return [];
  return [{
    note_ids: picked.map((n) => n.id).join(","),
    count: picked.length,
    notes: picked.map((n) => ({ id: n.id, title: n.title, why: n.why })),
    _dedupe_key: `reweave:${t0}`,
  }];
}

const batchOf = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 12) : 6;
};

export const unwovenNotesTrigger = createTrigger({
  auth: knowledgeVaultAuth,
  name: "unwoven-notes",
  displayName: "Unwoven notes",
  description:
    "Starts a run for a few notes the pipeline left unwoven while the pipeline is idle: what the vault's health report flags (notes nothing links to, notes with fewer than 2 links, notes in no MoC), or only orphans in no Map of Content. Map {{trigger.payload.note_ids}} into Reweave notes.",
  type: TriggerStrategy.POLLING,
  props: {
    drive: driveProp,
    batch: Property.Number({
      displayName: "Notes per run",
      description: "At most this many notes go into one run (1–12, default 6); one run starts per check",
      required: false,
      defaultValue: 6,
    }),
    select: Property.StaticDropdown({
      displayName: "Which notes",
      description: "What the health report flags: the notes its orphan and link checks name, and notes in no MoC; repairing them is what moves the report. Orphans: notes in no MoC that nothing links to.",
      required: false,
      defaultValue: "health",
      options: {
        disabled: false,
        options: [
          { label: "What the health report flags", value: "health" },
          { label: "Orphans in no MoC", value: "orphans" },
          { label: "Orphans, and notes with no links", value: "unlinked" },
        ],
      },
    }),
    include_unlinked: Property.Checkbox({
      displayName: "Also notes with no links (older workflows)",
      description: "Read only when Which notes is not set: off, orphans in no MoC; on, also notes with no links to other notes",
      required: false,
      defaultValue: false,
    }),
  },
  outputSchema: {
    fields: [
      { key: "note_ids", label: "Note ids" },
      { key: "count", label: "Notes" },
      { key: "notes", label: "Notes (id, title, why)" },
    ],
  },
  sampleData: { note_ids: "3DQI0WaU…,Fq2k…", count: 2, notes: [{ id: "3DQI0WaU…", title: "Nemotron 3 Super uses 20 trillion tokens for broad coverage then 5 trillion tokens emphasizing quality", why: "in no MoC, and nothing links to it" }] },
  async onEnable(context) {
    // Unlike new pipeline tasks, what is unwoven already is the point: nothing counts as seen.
    await context.store.put(TRIED_KEY, null);
  },
  async onDisable(context) {
    await context.store.put(TRIED_KEY, null);
  },
  async run(context) {
    const p = context.propsValue as { drive: string; batch?: unknown; select?: unknown; include_unlinked?: boolean };
    return pollUnwoven(clientFor(context.auth), context.store as StoreLike, { drive: p.drive, batch: batchOf(p.batch), select: selectionOf(p) });
  },
  async test(context) {
    const p = context.propsValue as { drive: string; batch?: unknown; select?: unknown; include_unlinked?: boolean };
    const t0 = Date.now();
    const { notes } = await findUnwoven(clientFor(context.auth), { drive: p.drive, select: selectionOf(p) }, t0);
    const picked = notes.slice(0, batchOf(p.batch));
    return picked.length ? [{ note_ids: picked.map((n) => n.id).join(","), count: picked.length, notes: picked.map((n) => ({ id: n.id, title: n.title, why: n.why })), _dedupe_key: `reweave:test:${t0}` }] : [];
  },
});
