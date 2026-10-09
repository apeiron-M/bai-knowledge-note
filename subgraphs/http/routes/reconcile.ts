import type { PHDocument } from "document-model";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { canonicalForWrite } from "../lib/authorize.js";
import type { GraphQuery, HttpRouteDeps } from "../lib/deps.js";
import {
  CONNECTING_LINK_TYPES,
  isAbandoned,
  planReconcile,
  type ReconcilePlan,
  type ReconcileTask,
  type SourceEvidence,
} from "../lib/reconcile.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";
import { rejectUnknownFields } from "../lib/validate.js";
import { executeWrite } from "../lib/write.js";

/**
 * `POST tasks/reconcile` — the pipeline queue caught up with the vault
 * (lib/reconcile.ts decides what the evidence proves). Body `{ drive,
 * source?, dryRun?, by? }`: the whole vault, or one source's tasks; `dryRun`
 * returns the plan without writing; `by` names the caller in the handoffs.
 * Needs write access to the drive and the queue. One run per vault at a
 * time, so two callers never advance the same task twice.
 */

export type ReconcileRouteDeps = HttpRouteDeps & {
  graph(driveId: string): Pick<GraphQuery, "edgesTouching" | "nodesByDocumentIds">;
};

type Body = { drive?: unknown; source?: unknown; dryRun?: unknown; by?: unknown };
type Node = { id?: string; documentType?: string };
type SourceState = { title?: string | null; status?: string | null; extractedClaims?: unknown[]; extractionStats?: unknown };

const locks = new Map<string, Promise<unknown>>();
const BATCH = 8;

const claimRefOf = (c: unknown): string | null =>
  typeof c === "string" ? c : c && typeof c === "object" && typeof (c as { claimRef?: unknown }).claimRef === "string" ? (c as { claimRef: string }).claimRef : null;

async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += BATCH) out.push(...(await Promise.all(items.slice(i, i + BATCH).map(work))));
  return out;
}

/** What the vault holds for each source: its own state, plus the notes, links and MoC places from the graph index. */
export async function gatherEvidence(deps: ReconcileRouteDeps, drive: string, sourceIds: readonly string[]): Promise<Map<string, SourceEvidence>> {
  const evidence = new Map<string, SourceEvidence>();
  if (sourceIds.length === 0) return evidence;
  const graph = deps.graph(drive);
  const docs = await inBatches(sourceIds, async (id) => ({ id, doc: await deps.reactorClient.get(id) }));
  const sourceEdges = await graph.edgesTouching([...sourceIds]);
  const listedBy = new Map<string, string[]>();
  const derivedBy = new Map<string, string[]>();
  for (const { id, doc } of docs) {
    const g = ((doc.state as { global?: SourceState } | undefined)?.global ?? {});
    listedBy.set(id, (g.extractedClaims ?? []).map(claimRefOf).filter((x): x is string => !!x));
    derivedBy.set(
      id,
      sourceEdges.filter((e) => e.linkType === "DERIVED_FROM" && e.targetDocumentId === id).map((e) => e.sourceDocumentId),
    );
  }
  const allNotes = [...new Set([...listedBy.values(), ...derivedBy.values()].flat())];
  const nodes = await graph.nodesByDocumentIds(allNotes);
  const live = allNotes.filter((id) => nodes.get(id)?.status !== "ARCHIVED");
  const noteEdges = await graph.edgesTouching(live);
  const linked = new Set<string>();
  const placed = new Set<string>();
  for (const e of noteEdges) {
    if (e.linkType && CONNECTING_LINK_TYPES.has(e.linkType)) {
      linked.add(e.sourceDocumentId);
      linked.add(e.targetDocumentId);
    }
    if (e.linkType === "CORE_IDEA") placed.add(e.targetDocumentId);
  }
  const liveSet = new Set(live);
  for (const { id, doc } of docs) {
    const g = ((doc.state as { global?: SourceState } | undefined)?.global ?? {});
    const listed = listedBy.get(id) ?? [];
    const derived = derivedBy.get(id) ?? [];
    const ids = [...new Set([...listed, ...derived])].filter((n) => liveSet.has(n));
    evidence.set(id, {
      id,
      title: g.title || (doc as { header?: { name?: string } }).header?.name || id,
      status: g.status ?? null,
      statsRecorded: !!g.extractionStats,
      notes: ids.map((n) => ({ id: n, indexed: nodes.has(n), linked: linked.has(n), placed: placed.has(n) })),
      unlisted: derived.filter((n) => liveSet.has(n) && !listed.includes(n)),
    });
  }
  return evidence;
}

type Outcome = {
  drive: string;
  dryRun: boolean;
  advanced: { taskId: string; sourceId: string; title: string; from: string; to: string; phases: string[]; status: string | null; phase: string | null }[];
  sources: { sourceId: string; title: string; addedClaims: number; closed: boolean }[];
  left: ReconcilePlan["left"];
  rejected: { documentId: string; type: string; error: string }[];
};

async function reconcile(deps: ReconcileRouteDeps, body: Body, ctx: RouteContext): Promise<Outcome> {
  const drive = typeof body.drive === "string" ? body.drive.trim() : "";
  const source = typeof body.source === "string" && body.source.trim() ? body.source.trim() : null;
  const dryRun = body.dryRun === true;
  const by = typeof body.by === "string" && body.by.trim() ? body.by.trim().slice(0, 80) : null;

  const driveId = await canonicalForWrite(deps, drive, ctx);
  const driveDoc = await deps.reactorClient.get(driveId);
  const nodes = ((driveDoc.state as { global?: { nodes?: Node[] } } | undefined)?.global?.nodes ?? []);
  const queueNode = nodes.find((n) => n.documentType === "bai/pipeline-queue")?.id;
  if (!queueNode) throw new HttpError(404, "NOT_FOUND", `No pipeline queue in drive ${drive}`);
  const sourceIds = new Set(nodes.filter((n) => n.documentType === "bai/source" && n.id).map((n) => n.id!));
  const queueId = await canonicalForWrite(deps, queueNode, ctx);
  const tasksOf = (doc: PHDocument) => ((doc.state as { global?: { tasks?: ReconcileTask[] } } | undefined)?.global?.tasks ?? []);
  const tasks = tasksOf(await deps.reactorClient.get(queueId)).filter((t) => !source || t.documentRef === source);

  const now = deps.now().getTime();
  const workable = (t: ReconcileTask) => t.status === "PENDING" || isAbandoned(t, now);
  const wanted = [...new Set(tasks.filter((t) => t.taskType === "claim" && workable(t) && t.documentRef && sourceIds.has(t.documentRef)).map((t) => t.documentRef!))];
  const plan = planReconcile(tasks, await gatherEvidence(deps, drive, wanted), { now });
  const out: Outcome = { drive, dryRun, advanced: [], sources: [], left: plan.left, rejected: [] };
  const describe = (p: ReconcilePlan["tasks"][number], status: string | null, phase: string | null) => ({
    taskId: p.taskId, sourceId: p.sourceId, title: p.title, from: p.from, to: p.to, phases: p.handoffs.map((h) => h.phase), status, phase,
  });
  if (dryRun) {
    out.sources = plan.sources.map((s) => ({ sourceId: s.sourceId, title: s.title, addedClaims: s.addClaims.length, closed: s.close }));
    out.advanced = plan.tasks.map((p) => describe(p, null, null));
    return out;
  }

  // The sources first: a task must not say "extracted" over a source that does not.
  const failedSources = new Set<string>();
  for (const s of plan.sources) {
    const id = await canonicalForWrite(deps, s.sourceId, ctx);
    const actions = [
      ...s.addClaims.map((claimRef) => ({ type: "ADD_EXTRACTED_CLAIM", input: { claimRef } })),
      ...(s.close ? [{ type: "SET_SOURCE_STATUS", input: { status: "EXTRACTED" } }] : []),
    ];
    const result = await executeWrite(deps, { documentId: id, document: await deps.reactorClient.get(id), actions, ctx, wait: true });
    const errors = result.operations.filter((o) => o.error);
    for (const o of errors) out.rejected.push({ documentId: s.sourceId, type: o.type, error: o.error! });
    if (errors.length || result.readBack !== "confirmed") failedSources.add(s.sourceId);
    else out.sources.push({ sourceId: s.sourceId, title: s.title, addedClaims: s.addClaims.length, closed: s.close });
  }

  const at = deps.now().toISOString();
  const doable = plan.tasks.filter((p) => {
    if (!failedSources.has(p.sourceId)) return true;
    out.left.push({ taskId: p.taskId, sourceId: p.sourceId, phase: p.from, reason: "the source could not be brought up to date" });
    return false;
  });
  if (doable.length) {
    const actions = doable.flatMap((p) =>
      p.handoffs.map((h) => ({
        type: "ADVANCE_PHASE",
        input: {
          taskId: p.taskId,
          handoff: { id: deps.uuid(), phase: h.phase, workDone: h.workDone, filesModified: h.filesModified, completedAt: at, completedBy: by ? `pipeline catch-up · ${by}` : "pipeline catch-up" },
          updatedAt: at,
        },
      })),
    );
    const result = await executeWrite(deps, { documentId: queueId, document: await deps.reactorClient.get(queueId), actions, ctx, wait: true });
    for (const o of result.operations) if (o.error) out.rejected.push({ documentId: queueNode, type: o.type, error: o.error });
    // Read back: report where each task really is, not where the plan meant it to go.
    const after = new Map(tasksOf(await deps.reactorClient.get(queueId)).map((t) => [t.id, t]));
    out.advanced = doable.map((p) => {
      const t = after.get(p.taskId);
      return describe(p, t?.status ?? null, t?.currentPhase ?? null);
    });
  }
  return out;
}

export function createReconcileRoute(deps: ReconcileRouteDeps) {
  return async function handleReconcile(request: Request, ctx: RouteContext): Promise<Response> {
    try {
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        raw = null; // no body: the drive can come in the query
      }
      if (raw !== null && (typeof raw !== "object" || Array.isArray(raw))) throw new HttpError(400, "BAD_REQUEST", "The body must be a JSON object");
      let body = (raw ?? {}) as Body;
      if (body.drive === undefined) body = { ...body, drive: new URL(request.url).searchParams.get("drive") ?? undefined };
      rejectUnknownFields(body as Record<string, unknown>, ["drive", "source", "dryRun", "by"]);
      if (typeof body.drive !== "string" || !body.drive.trim()) throw new HttpError(400, "BAD_REQUEST", "drive is required");
      if (body.source !== undefined && typeof body.source !== "string") throw new HttpError(400, "BAD_REQUEST", "source must be a document id");
      if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") throw new HttpError(400, "BAD_REQUEST", "dryRun must be true or false");
      if (body.by !== undefined && typeof body.by !== "string") throw new HttpError(400, "BAD_REQUEST", "by must be text");
      const key = body.drive.trim();
      const previous = locks.get(key) ?? Promise.resolve();
      const run = previous.catch(() => undefined).then(() => reconcile(deps, body, ctx));
      locks.set(key, run);
      try {
        return Response.json(await run, { headers: OK_CACHE });
      } finally {
        if (locks.get(key) === run) locks.delete(key);
      }
    } catch (error) {
      return jsonError(error);
    }
  };
}
