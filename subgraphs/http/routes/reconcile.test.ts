import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import {
  addTask,
  assignTask,
  reducer as queueReducer,
  utils as queueUtils,
} from "document-models/pipeline-queue/v2";
import {
  addExtractedClaim,
  ingestSource,
  recordExtractionStats,
  reducer as sourceReducer,
  setSourceStatus,
  utils as sourceUtils,
} from "document-models/source/v2";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import { createReconcileRoute, type ReconcileRouteDeps } from "./reconcile.js";

const ctx = {
  user: { address: "0xabc", chainId: 1, networkId: "eip155", appKey: "did:key:z" },
  params: {},
  authEnabled: true,
  signal: undefined,
  transport: { proto: "http", host: "h", prefix: "", baseUrl: "http://h" },
} as unknown as RouteContext;
const T = "2026-10-08T20:00:00.000Z";

type Doc = { header: { id: string; documentType: string; revision: Record<string, number> }; state: unknown; operations: { global: { index: number; error?: string; action: { id: string; type: string } }[] } };

function source(id: string, title: string, steps: (d: ReturnType<typeof sourceUtils.createDocument>) => ReturnType<typeof sourceUtils.createDocument>) {
  let d = sourceUtils.createDocument();
  d = sourceReducer(d, ingestSource({ title, content: "text", sourceType: "ARTICLE", createdAt: T }));
  d = steps(d);
  return { ...d, header: { ...d.header, id } } as unknown as Doc;
}

/** A vault in memory whose writes go through the models' real reducers, so the route is held to what they accept. */
function vault(options: { refuse?: string[]; now?: string } = {}) {
  let queue = queueUtils.createDocument();
  const add = (id: string, ref: string, extra?: (q: typeof queue) => typeof queue) => {
    queue = queueReducer(queue, addTask({ id, taskType: "claim", target: ref, documentRef: ref, createdAt: T }));
    if (extra) queue = extra(queue);
  };
  add("t-extracted", "s-extracted");
  add("t-cut", "s-cut");
  add("t-empty", "s-empty");
  add("t-new", "s-new");
  add("t-held", "s-extracted", (q) => queueReducer(q, assignTask({ taskId: "t-held", assignedTo: "0xworker", updatedAt: T })));
  const docs = new Map<string, Doc>([
    ["queue-1", { ...queue, header: { ...queue.header, id: "queue-1" } } as unknown as Doc],
    ["s-extracted", source("s-extracted", "Extracted", (d) => {
      d = sourceReducer(d, setSourceStatus({ status: "EXTRACTING" }));
      d = sourceReducer(d, addExtractedClaim({ claimRef: "n1" }));
      d = sourceReducer(d, addExtractedClaim({ claimRef: "n2" }));
      d = sourceReducer(d, recordExtractionStats({ claimCount: 2, skippedCount: 1, skipRate: 0.33, extractedAt: T }));
      return sourceReducer(d, setSourceStatus({ status: "EXTRACTED" }));
    })],
    ["s-cut", source("s-cut", "Cut off", (d) => sourceReducer(d, setSourceStatus({ status: "EXTRACTING" })))],
    ["s-empty", source("s-empty", "Contacts page", (d) => {
      d = sourceReducer(d, setSourceStatus({ status: "EXTRACTING" }));
      d = sourceReducer(d, recordExtractionStats({ claimCount: 0, skippedCount: 0, skipRate: 0, extractedAt: T }));
      return sourceReducer(d, setSourceStatus({ status: "EXTRACTED" }));
    })],
    ["s-new", source("s-new", "Not yet", (d) => sourceReducer(d, setSourceStatus({ status: "EXTRACTING" })))],
    ["d", {
      header: { id: "d", documentType: "powerhouse/document-drive", revision: {} },
      state: { global: { nodes: [{ id: "queue-1", documentType: "bai/pipeline-queue" }, ...["s-extracted", "s-cut", "s-empty", "s-new"].map((id) => ({ id, documentType: "bai/source" }))] } },
      operations: { global: [] },
    }],
  ]);
  const edges = [
    { sourceDocumentId: "n1", targetDocumentId: "s-extracted", linkType: "DERIVED_FROM" },
    { sourceDocumentId: "n2", targetDocumentId: "s-extracted", linkType: "DERIVED_FROM" },
    { sourceDocumentId: "n1", targetDocumentId: "n2", linkType: "RELATES_TO" },
    { sourceDocumentId: "n3", targetDocumentId: "s-cut", linkType: "DERIVED_FROM" },
    { sourceDocumentId: "n3", targetDocumentId: "n1", linkType: "BUILDS_ON" },
    { sourceDocumentId: "moc", targetDocumentId: "n3", linkType: "CORE_IDEA" },
  ].map((e, i) => ({ id: `e${i}`, targetTitle: null, updatedAt: T, reason: null, confidence: null, metadataJson: null, ...e }));
  const notes = new Map(["n1", "n2", "n3"].map((id) => [id, { id, documentId: id, status: "IN_REVIEW" }]));
  const refuse = new Set(options.refuse ?? []);
  const reactorClient = createFakeReactorClient({
    get: vi.fn(async (id: string) => {
      const doc = docs.get(id);
      if (!doc) throw new Error(`no document ${id}`);
      return doc;
    }) as never,
    executeAsync: vi.fn(async (id: string, _branch: string, actions: { id: string; type: string }[]) => {
      let doc = docs.get(id)!;
      const reduce = doc.header.documentType === "bai/pipeline-queue" ? queueReducer : sourceReducer;
      for (const action of actions) {
        if (refuse.has(id)) {
          const index = doc.operations.global.length;
          doc.operations.global.push({ index, error: "Refused by the test", action });
          continue;
        }
        doc = reduce(doc as never, action as never) as unknown as Doc;
      }
      docs.set(id, doc);
      return { id: "job-1" };
    }) as never,
    getOperations: vi.fn(async (id: string, _v: unknown, filter: { sinceRevision: number }) => ({
      results: docs.get(id)!.operations.global.filter((op) => op.index >= filter.sinceRevision),
    })) as never,
  });
  const deps: ReconcileRouteDeps = {
    reactorClient,
    resolveCanonicalDocumentId: (async (id: string) => id) as never,
    authorization: { canRead: vi.fn(async () => true), canWrite: vi.fn(async () => true), canMutate: vi.fn(async () => true), isSupremeAdmin: vi.fn(() => false) },
    now: () => new Date(options.now ?? "2026-10-08T21:30:00.000Z"),
    uuid: (() => {
      let n = 0;
      return () => `uuid-${++n}`;
    })(),
    graph: () => ({
      edgesTouching: async (ids: string[]) => edges.filter((e) => ids.includes(e.sourceDocumentId) || ids.includes(e.targetDocumentId)),
      nodesByDocumentIds: async (ids: string[]) => new Map(ids.filter((id) => notes.has(id)).map((id) => [id, notes.get(id)!])) as never,
    }),
  };
  const state = (id: string) => (docs.get(id)!.state as { global: Record<string, unknown> }).global;
  const task = (id: string) => (state("queue-1").tasks as { id: string; status: string; currentPhase: string | null; handoffs: { phase: string; completedBy: string; workDone: string }[] }[]).find((t) => t.id === id)!;
  return { deps, docs, state, task, reactorClient };
}

const post = (body: unknown, query = "") =>
  new Request(`http://h/tasks/reconcile${query}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST tasks/reconcile", () => {
  it("advances each task as far as the vault proves, repairs a cut-off source first, and reports where the tasks really are", async () => {
    const v = vault();
    const res = await createReconcileRoute(v.deps)(post({ drive: "d", by: "test" }), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { advanced: { taskId: string; to: string; phases: string[]; status: string; phase: string | null }[]; sources: unknown[]; left: { taskId: string; reason: string }[]; rejected: unknown[] };
    expect(body.rejected).toEqual([]);
    expect(body.advanced.map((a) => [a.taskId, a.phases.join(">"), a.to, a.status, a.phase])).toEqual([
      // n1 and n2 link to each other, so both count as connected; neither is in a MoC
      ["t-extracted", "create>reflect", "reweave", "PENDING", "reweave"],
      ["t-cut", "create>reflect>reweave", "verify", "PENDING", "verify"],
      ["t-empty", "create>reflect>reweave>verify", "done", "DONE", null],
    ]);
    expect(body.sources).toEqual([{ sourceId: "s-cut", title: "Cut off", addedClaims: 1, closed: true }]);
    expect(body.left.map((l) => [l.taskId, l.reason])).toEqual([
      ["t-new", "the source has not been extracted yet"],
      ["t-held", "held by 0xworker; whoever holds it reports it"],
    ]);
    // the models' own state, after the real reducers ran
    expect(v.state("s-cut")).toMatchObject({ status: "EXTRACTED", extractedClaims: ["n3"], extractionStats: null });
    expect(v.state("queue-1")).toMatchObject({ completedCount: 1 });
    expect(v.task("t-empty").handoffs.map((h) => h.completedBy)).toEqual(Array(4).fill("pipeline catch-up · test"));
    expect(v.task("t-held")).toMatchObject({ status: "IN_PROGRESS", currentPhase: "create", handoffs: [] });
  });

  it("is idempotent: a second pass finds nothing more to do", async () => {
    const v = vault();
    await createReconcileRoute(v.deps)(post({ drive: "d" }), ctx);
    const again = (await (await createReconcileRoute(v.deps)(post({ drive: "d" }), ctx)).json()) as { advanced: unknown[]; sources: unknown[] };
    expect(again).toMatchObject({ advanced: [], sources: [] });
  });

  it("never advances a task twice when two callers race", async () => {
    const v = vault();
    const route = createReconcileRoute(v.deps);
    const [a, b] = await Promise.all([route(post({ drive: "d" }), ctx), route(post({ drive: "d" }), ctx)]);
    const bodies = (await Promise.all([a.json(), b.json()])) as { rejected: unknown[]; advanced: unknown[] }[];
    expect(bodies.map((x) => x.rejected)).toEqual([[], []]);
    expect(bodies.map((x) => x.advanced.length)).toEqual([3, 0]);
    expect(v.task("t-empty").handoffs).toHaveLength(4);
  });

  it("dry run plans without writing; one source narrows it", async () => {
    const v = vault();
    const dry = (await (await createReconcileRoute(v.deps)(post({ drive: "d", dryRun: true }), ctx)).json()) as { dryRun: boolean; advanced: { taskId: string; status: null }[]; sources: { closed: boolean }[] };
    expect(dry.dryRun).toBe(true);
    expect(dry.advanced.map((a) => a.taskId)).toEqual(["t-extracted", "t-cut", "t-empty"]);
    expect(dry.sources).toEqual([{ sourceId: "s-cut", title: "Cut off", addedClaims: 1, closed: true }]);
    expect(v.reactorClient.executeAsync).not.toHaveBeenCalled();
    const one = (await (await createReconcileRoute(v.deps)(post({ source: "s-empty" }, "?drive=d"), ctx)).json()) as { advanced: { taskId: string }[]; left: unknown[] };
    expect(one.advanced.map((a) => a.taskId)).toEqual(["t-empty"]);
    expect(one.left).toEqual([]);
  });

  it("leaves a task where it is when its source cannot be repaired, and reports refused advances", async () => {
    const cut = vault({ refuse: ["s-cut"] });
    const body = (await (await createReconcileRoute(cut.deps)(post({ drive: "d" }), ctx)).json()) as { advanced: { taskId: string }[]; left: { taskId: string; reason: string }[]; rejected: { documentId: string; error: string }[] };
    expect(body.advanced.map((a) => a.taskId)).toEqual(["t-extracted", "t-empty"]);
    expect(body.left).toContainEqual({ taskId: "t-cut", sourceId: "s-cut", phase: "create", reason: "the source could not be brought up to date" });
    expect(body.rejected[0]).toMatchObject({ documentId: "s-cut", error: "Refused by the test" });
    expect(cut.task("t-cut").currentPhase).toBe("create");

    const queue = vault({ refuse: ["queue-1"] });
    const refused = (await (await createReconcileRoute(queue.deps)(post({ drive: "d" }), ctx)).json()) as { advanced: { taskId: string; phase: string }[]; rejected: { type: string }[] };
    expect(refused.rejected.every((r) => r.type === "ADVANCE_PHASE")).toBe(true);
    expect(refused.advanced.map((a) => a.phase)).toEqual(["create", "create", "create"]);
  });

  it("refuses bad requests before touching anything", async () => {
    const v = vault();
    const route = createReconcileRoute(v.deps);
    const status = async (req: Request) => (await route(req, ctx)).status;
    expect(await status(post({}))).toBe(400);
    expect(await status(post({ drive: "  " }))).toBe(400);
    expect(await status(post({ drive: "d", extra: 1 }))).toBe(400);
    expect(await status(post({ drive: "d", source: 5 }))).toBe(400);
    expect(await status(post({ drive: "d", dryRun: "yes" }))).toBe(400);
    expect(await status(post({ drive: "d", by: 1 }))).toBe(400);
    expect(await status(post([1]))).toBe(400);
    expect(v.reactorClient.executeAsync).not.toHaveBeenCalled();
    // no body at all is fine: the drive can come in the query
    expect(await status(new Request("http://h/tasks/reconcile?drive=d", { method: "POST", body: "not json" }))).toBe(200);
    v.docs.set("d", { ...v.docs.get("d")!, state: { global: { nodes: [] } } });
    expect(await status(post({ drive: "d" }))).toBe(404);
  });

  it("takes over a task held long after its run must have ended", async () => {
    const v = vault({ now: "2026-10-09T01:00:00.000Z" });
    const body = (await (await createReconcileRoute(v.deps)(post({ drive: "d" }), ctx)).json()) as { advanced: { taskId: string; phase: string }[]; left: { taskId: string }[] };
    expect(body.advanced.map((a) => [a.taskId, a.phase])).toContainEqual(["t-held", "reweave"]);
    expect(v.task("t-held")).toMatchObject({ status: "PENDING", currentPhase: "reweave" });
    expect(v.task("t-held").handoffs[0].workDone).toMatch(/held by 0xworker since 2026-10-08T20:00:00.000Z; that run is gone/);
    expect(body.left.map((l) => l.taskId)).toEqual(["t-new"]);
  });
});
