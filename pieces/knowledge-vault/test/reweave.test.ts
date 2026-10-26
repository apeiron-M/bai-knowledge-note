import { describe, expect, it } from "vitest";
import { LlmClient } from "../lib/agent/llm.js";
import { proposeLinksStage } from "../lib/agent/connect.js";
import { needsLinks, parseNoteIds, readReweaveNotes, reweave } from "../lib/agent/reweave.js";
import { stageRunner } from "../lib/agent/runner.js";
import type { KnowledgeVaultClient, RequestOptions } from "../lib/common/client.js";
import { MAX_TRIES, PIPELINE_QUIET_MS, pollUnwoven, RETRY_AFTER_MS, RETRY_GROWTH, selectionOf, SETTLE_MS } from "../lib/triggers/unwoven-notes.js";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
function modelSays(...answers: unknown[]) {
  let i = 0;
  const fetchImpl = (async () => json({ choices: [{ message: { content: JSON.stringify(answers[Math.min(i++, answers.length - 1)]) } }], usage: { cost: 0.001 } })) as unknown as typeof fetch;
  return { llm: new LlmClient({ baseUrl: "https://llm.test/v1", apiKey: "k" }, fetchImpl), fetchImpl };
}
/** A fake vault: routes by path prefix (longest first); a function route sees the request. */
function vault(routes: Record<string, unknown>) {
  const requests: RequestOptions[] = [];
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
  const client = {
    request: async (o: RequestOptions) => {
      requests.push(o);
      const key = keys.find((k) => o.path === k || o.path.startsWith(k));
      if (!key) throw new Error(`no route ${o.path}`);
      const v = routes[key];
      return typeof v === "function" ? (v as (o: RequestOptions) => unknown)(o) : v;
    },
  } as unknown as KnowledgeVaultClient;
  return { client, requests };
}
function memoryStore() {
  const values = new Map<string, unknown>();
  return { get: (k: string) => Promise.resolve(values.get(k)), put: (k: string, v: unknown) => Promise.resolve((values.set(k, v), v)), values };
}

describe("the unwoven-notes trigger", () => {
  it("waits for an idle pipeline, takes settled orphans oldest first, and tries a note again only once the vault has grown", async () => {
    const t = (iso: string) => Date.parse(iso);
    let clock = t("2026-10-10T22:00:00Z");
    const now = () => clock;
    const tasks: unknown[] = [{ taskType: "claim", status: "IN_PROGRESS", updatedAt: "2026-10-10T21:55:00Z" }];
    let noteCount = 100;
    const orphans = [
      { documentId: "hub", title: "Vault", status: "MOC", documentType: "bai/moc", createdAt: "2026-10-10T10:00:00Z" },
      { documentId: "n-late", title: "Later", status: "IN_REVIEW", documentType: "bai/knowledge-note", createdAt: "2026-10-10T20:30:00Z" },
      { documentId: "n-early", title: "Earlier", status: "IN_REVIEW", documentType: "bai/knowledge-note", createdAt: "2026-10-10T20:20:00Z" },
      // Always just extracted: a source still on its way through the pipeline.
      { documentId: "n-new", title: "Still in the pipeline", status: "DRAFT", documentType: "bai/knowledge-note", createdAt: "" },
      { documentId: "n-gone", title: "Archived", status: "ARCHIVED", documentType: "bai/knowledge-note", createdAt: "2026-10-10T09:00:00Z" },
    ];
    const v = vault({ "notes/d": { state: { global: { nodes: [{ id: "q1", documentType: "bai/pipeline-queue" }] } } }, "notes/q1": () => ({ state: { global: { tasks } } }), orphans: () => orphans.map((o) => (o.documentId === "n-new" ? { ...o, createdAt: new Date(clock - SETTLE_MS / 2).toISOString() } : o)), stats: () => ({ noteCount }) });
    const store = memoryStore();
    const poll = () => pollUnwoven(v.client, store, { drive: "d", batch: 6, select: "orphans" }, now);

    // A source is being processed: nothing starts, nothing is read beyond the queue.
    expect(await poll()).toEqual([]);
    expect(v.requests.some((r) => r.path === "orphans")).toBe(false);
    // A waiting task touched lately still counts as at work; a stuck one (untouched for long) does not.
    tasks[0] = { taskType: "claim", status: "PENDING", updatedAt: new Date(clock - PIPELINE_QUIET_MS / 2).toISOString() };
    expect(await poll()).toEqual([]);
    tasks[0] = { taskType: "claim", status: "PENDING", updatedAt: "2026-10-10T19:00:00Z" };

    const first = await poll();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ note_ids: "n-early,n-late", count: 2, notes: [{ id: "n-early", title: "Earlier" }, { id: "n-late", title: "Later" }] });

    // Tried: not again within the hour, nor later while the vault has not grown.
    clock += 5 * 60_000;
    expect(await poll()).toEqual([]);
    clock += RETRY_AFTER_MS;
    expect(await poll()).toEqual([]);
    noteCount += RETRY_GROWTH;
    // n-late was woven meanwhile: it leaves the orphans and the record.
    orphans.splice(1, 1);
    expect((await poll())[0]).toMatchObject({ note_ids: "n-early", count: 1 });
    expect(Object.keys(store.values.get("knowledge-vault:unwoven-notes:tried") as object)).toEqual(["n-early"]);

    // At most MAX_TRIES tries, however much the vault grows.
    for (let i = 2; i < MAX_TRIES; i++) {
      clock += RETRY_AFTER_MS;
      noteCount += RETRY_GROWTH;
      expect(await poll()).toHaveLength(1);
    }
    clock += RETRY_AFTER_MS;
    noteCount += RETRY_GROWTH;
    expect(await poll()).toEqual([]);
  });
});

describe("the reweave job", () => {
  it("links a note that has too few links, places a note no MoC holds, and catches up the task its source left open", async () => {
    const edges = {
      n1: [{ direction: "out", documentId: "s1", linkType: "DERIVED_FROM" }],
      n2: [{ direction: "in", documentId: "m1", linkType: "CORE_IDEA" }, { direction: "out", documentId: "s2", linkType: "DERIVED_FROM" }],
    };
    const note = (id: keyof typeof edges, title: string) => ({ name: id, documentType: "bai/knowledge-note", state: { global: { title, description: `${title}, described`, status: "IN_REVIEW" } }, edges: edges[id] });
    let reconciles = 0;
    const v = vault({
      "notes/n1/similar": [{ similarity: 0.88, node: { documentId: "old1", title: "Pretraining data mixes decide what a model can learn", description: "", status: "CANONICAL" } }],
      "notes/n2/similar": [{ similarity: 0.81, node: { documentId: "old2", title: "Compute budgets set the size of a training run", description: "", status: "CANONICAL" } }],
      "notes/n1": note("n1", "Two-stage pretraining trades breadth for quality"),
      "notes/n2": note("n2", "Smaller models catch up through better data"),
      "notes/x9": { name: "x9", documentType: "bai/knowledge-note", state: { global: { title: "Old", status: "ARCHIVED" } }, edges: [] },
      "graph.json": { nodes: [{ documentId: "m1", title: "Training data", description: "How data shapes models", noteType: "MOC (TOPIC)", status: "MOC" }, { documentId: "hub", title: "Vault", noteType: "MOC (HUB)", status: "MOC" }], edges: [{ sourceDocumentId: "hub", targetDocumentId: "m1", linkType: "CHILD_MOC" }, { sourceDocumentId: "m1", targetDocumentId: "n2", linkType: "CORE_IDEA" }] },
      "notes/d": { state: { global: { nodes: [{ id: "q1", documentType: "bai/pipeline-queue" }] } } },
      "notes/q1": { state: { global: { tasks: [{ id: "t1", taskType: "claim", status: "PENDING", documentRef: "s1", currentPhase: "reflect" }, { id: "t2", taskType: "claim", status: "DONE", documentRef: "s2" }] } } },
      // The index has not taken the new links yet on the first ask.
      "tasks/reconcile": () => (++reconciles === 1 ? { advanced: [], left: [{ reason: "1 note not connected yet" }] } : { advanced: [{ taskId: "t1", phases: ["reflect", "reweave"], to: "verify", phase: "verify" }] }),
      relationships: {},
    });
    const links = { links: [
      { from: "n1", to: "old1", type: "BUILDS_ON", reason: "The two-stage recipe is one answer to how data mixes decide what a model learns", confidence: "grounded" },
      { from: "n2", to: "old2", type: "RELATES_TO", reason: "Better data and bigger compute budgets are the two levers a lab pulls", confidence: "established" },
    ] };
    const places = { placements: [{ note: "n1", moc: "m1" }] };
    // Each run asks twice: links, then placements.
    const m = modelSays(links, places, links, places);
    const pauses: number[] = [];
    const run = (write: boolean) => reweave(v.client, m.llm, "m", { drive: "d", noteIds: parseNoteIds("n1, n2 x9"), write, pause: (ms) => { pauses.push(ms); return Promise.resolve(); } }, stageRunner({}).stage, m.fetchImpl);

    const out = await run(true);
    expect(out.summary).toBe('Reweaved 2 notes: 2 links written; 1 note placed in "Training data". Caught the pipeline task up from the vault: reflect, reweave recorded, now at verify.');
    expect(out.skipped).toEqual([{ id: "x9", why: "is archived" }]);
    const writes = v.requests.filter((r) => r.path === "relationships").map((r) => r.json as { source: string; target: string; type: string });
    expect(writes.map((w) => `${w.source}>${w.target}:${w.type}`)).toEqual(["n1>old1:BUILDS_ON", "n2>old2:RELATES_TO", "m1>n1:CORE_IDEA"]);
    // Only the open task's source is caught up, and asked again once the index has the links.
    expect(v.requests.filter((r) => r.path === "tasks/reconcile").map((r) => (r.json as { source: string }).source)).toEqual(["s1", "s1"]);
    expect(pauses).toHaveLength(1);

    // A dry run proposes the same and writes nothing.
    const before = v.requests.length;
    const dry = await run(false);
    expect(dry.summary).toMatch(/^Dry run: Reweaved 2 notes: 2 links proposed; 1 note would go to "Training data"\.$/);
    expect(v.requests.slice(before).some((r) => r.method === "POST")).toBe(false);
  });
});

/** The loop the health report closes: it flags notes, the Reweave notes workflow takes exactly those, links them, and the report moves. */
describe("keeping the vault healthy: Reweave takes what the health report flags", () => {
  const created = "2026-10-10T10:00:00Z";
  const note = (id: string) => ({ documentId: id, title: `Note ${id}`, status: "IN_REVIEW", documentType: "bai/knowledge-note", createdAt: created });
  const link = (from: string, to: string, linkType = "BUILDS_ON") => ({ sourceDocumentId: from, targetDocumentId: to, linkType });

  it("selects the notes the report's orphan and link checks name, counted as it counts them, and notes in no MoC", async () => {
    const graph = {
      nodes: [note("a"), note("b"), note("c"), note("d"), note("e"), { documentId: "m", title: "Map", status: "MOC", documentType: "bai/moc", createdAt: created }],
      edges: [
        link("a", "b"), link("a", "c"), link("b", "a"), link("b", "c"), link("c", "a"), link("c", "b"),
        // d links out twice but nothing links to d: an orphan, though a MoC holds it.
        link("d", "a"), link("d", "b", "RELATES_TO"),
        // e has one link of its own.
        link("e", "a"), link("a", "e"),
        ...["a", "b", "d", "e"].map((id) => link("m", id, "CORE_IDEA")),
      ],
    };
    const v = vault({ "notes/d": { state: { global: { nodes: [{ id: "q1", documentType: "bai/pipeline-queue" }] } } }, "notes/q1": { state: { global: { tasks: [{ status: "DONE", updatedAt: created }] } } }, "graph.json": graph });
    const [run] = await pollUnwoven(v.client, memoryStore(), { drive: "d", batch: 6, select: "health" }, () => Date.parse("2026-10-11T10:00:00Z"));
    expect(run.notes).toEqual([
      { id: "c", title: "Note c", why: "in no MoC" },
      { id: "d", title: "Note d", why: "nothing links to it" },
      { id: "e", title: "Note e", why: "fewer than 2 links of its own" },
    ]);
  });

  it("a workflow set up before the choice keeps what its checkbox said", () => {
    expect(selectionOf({})).toBe("orphans");
    expect(selectionOf({ include_unlinked: true })).toBe("unlinked");
    expect(selectionOf({ select: "health", include_unlinked: true })).toBe("health");
  });

  it("counts a note's links as the report does: an orphan with links of its own still needs one into it", async () => {
    const edges = (spec: string) => spec.split(" ").filter(Boolean).map((d) => ({ direction: d, documentId: "x", linkType: "RELATES_TO" }));
    const v = vault({
      "notes/out-only": { documentType: "bai/knowledge-note", state: { global: { title: "Out only" } }, edges: edges("out out") },
      "notes/fine": { documentType: "bai/knowledge-note", state: { global: { title: "Fine" } }, edges: edges("out out in") },
      "notes/in-only": { documentType: "bai/knowledge-note", state: { global: { title: "In only" } }, edges: edges("out in in in") },
    });
    const { notes } = await readReweaveNotes(v.client, "d", ["out-only", "fine", "in-only"]);
    expect(notes.map((n) => [n.id, n.incoming, n.outgoing, needsLinks(n)])).toEqual([["out-only", 0, 2, true], ["fine", 1, 2, false], ["in-only", 3, 1, true]]);
  });

  it("asks for a link into a note nothing links to, and takes a candidate's link pointing at it", async () => {
    const reason = "The budget note applies the capital claim to how technology money is spent.";
    const m = modelSays({ links: [
      { from: "x1", to: "n1", type: "BUILDS_ON", reason, confidence: "grounded" },
      { from: "zz", to: "n1", type: "RELATES_TO", reason },
    ] });
    let prompt = "";
    const spy = (async (url: string, init: { body?: string }) => {
      if (String(url).endsWith("/chat/completions")) prompt = String((JSON.parse(init.body ?? "{}") as { messages: { content: string }[] }).messages[1].content);
      return m.fetchImpl(url, init as never);
    }) as unknown as typeof fetch;
    const llm = new LlmClient({ baseUrl: "https://llm.test/v1", apiKey: "k" }, spy);
    const out = await proposeLinksStage(llm, "m", [{ id: "n1", title: "Capital is not the constraint", description: "d", status: null }], { n1: [{ id: "x1", title: "Budgets follow capital", description: "dx", status: null, similarity: 0.9 }] }, spy, { inbound: new Set(["n1"]) });
    expect(prompt).toMatch(/NEW n1: Capital is not the constraint\n {2}d\n {2}nothing links to it yet/);
    expect(out.links.map((l) => [l.from, l.to, l.type])).toEqual([["x1", "n1", "BUILDS_ON"]]);
    expect(out.dropped.map((d) => d.why)).toEqual(['from "zz" was not a candidate for n1']);
  });
});
