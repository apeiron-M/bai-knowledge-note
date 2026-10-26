import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmClient } from "../lib/agent/llm.js";
import { parseNoteIds, readReweaveNotes, reweave } from "../lib/agent/reweave.js";
import { stageRunner } from "../lib/agent/runner.js";
import type { KnowledgeVaultClient, RequestOptions } from "../lib/common/client.js";
import { findUnwoven, pollUnwoven, SETTLE_MS, unwovenNotesTrigger } from "../lib/triggers/unwoven-notes.js";

/**
 * The edges of the Reweave loop: the inputs a trigger or a person can hand it, vaults with nothing to do, and
 * the answers a model can give. reweave.test.ts covers the main paths.
 */
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
function modelSays(...answers: unknown[]) {
  let calls = 0;
  const fetchImpl = (async () => json({ choices: [{ message: { content: JSON.stringify(answers[Math.min(calls++, answers.length - 1)]) } }], usage: { cost: 0.001 } })) as unknown as typeof fetch;
  return { llm: new LlmClient({ baseUrl: "https://llm.test/v1", apiKey: "k" }, fetchImpl), fetchImpl, calls: () => calls };
}
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
function memoryStore(initial?: unknown) {
  const values = new Map<string, unknown>(initial === undefined ? [] : [["knowledge-vault:unwoven-notes:tried", initial]]);
  return { get: (k: string) => Promise.resolve(values.get(k)), put: (k: string, v: unknown) => Promise.resolve((values.set(k, v), v)), values };
}
const created = "2026-10-10T10:00:00Z";
const later = () => Date.parse("2026-10-11T10:00:00Z");
const link = (from: string, to: string, linkType = "BUILDS_ON") => ({ sourceDocumentId: from, targetDocumentId: to, linkType });

describe("the unwoven-notes trigger at its edges", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("with 'Orphans, and notes with no links', names what each note lacks; MoCs, archived notes and rows without an id are not notes", async () => {
    const graph = {
      nodes: [
        { documentId: "woven", title: "Woven", status: "IN_REVIEW", documentType: "bai/knowledge-note", createdAt: created },
        { documentId: "loose", title: "Loose", status: "IN_REVIEW", documentType: "bai/knowledge-note", createdAt: created },
        { documentId: "alone", title: "Alone", status: "IN_REVIEW", documentType: "bai/knowledge-note", createdAt: created },
        // No title, no creation time: named by its id, and taken as settled.
        { documentId: "bare", status: "DRAFT", documentType: "bai/knowledge-note" },
        { documentId: "gone", title: "Archived", status: "ARCHIVED", documentType: "bai/knowledge-note", createdAt: created },
        { documentId: "m", title: "Map", status: "MOC", documentType: "bai/moc", createdAt: created },
        { title: "No id", documentType: "bai/knowledge-note" },
      ],
      edges: [link("woven", "loose"), link("m", "woven", "CORE_IDEA"), link("m", "alone", "CORE_IDEA")],
    };
    const v = vault({ "notes/d": { state: { global: { nodes: [] } } }, "graph.json": graph });
    const [run] = await pollUnwoven(v.client, memoryStore(), { drive: "d", batch: 6, select: "unlinked" }, later);
    expect(run.notes).toEqual([
      // Without a creation time a note sorts first.
      { id: "bare", title: "bare", why: "in no MoC, with no links" },
      { id: "loose", title: "Loose", why: "in no MoC" },
      { id: "alone", title: "Alone", why: "no links to other notes" },
    ]);
    // No queue in the drive: the pipeline is not busy, and the queue is never read.
    expect(v.requests.map((r) => r.path)).toEqual(["notes/d", "graph.json"]);
  });

  it("with 'What the health report flags', a note with no links at all has every flag", async () => {
    const graph = {
      nodes: [{ documentId: "a", status: "DRAFT", documentType: "bai/knowledge-note" }, { documentId: "b", title: "B", status: "DRAFT", documentType: "bai/knowledge-note", createdAt: created }],
      // A link to a node outside the notes (a source) does not count.
      edges: [link("b", "a"), link("b", "src", "DERIVED_FROM"), link("b", "x-unknown")],
    };
    const v = vault({ "notes/d": { state: { global: { nodes: [] } } }, "graph.json": graph });
    const { notes } = await findUnwoven(v.client, { drive: "d", select: "health" }, later());
    expect(notes.map((n) => [n.id, n.title, n.why])).toEqual([
      ["a", "a", "fewer than 2 links of its own; in no MoC"],
      ["b", "B", "nothing links to it; fewer than 2 links of its own; in no MoC"],
    ]);
  });

  it("reads the orphans whichever shape the vault answers in, and an unreadable count as an empty vault", async () => {
    const row = { documentId: "o1", status: "IN_REVIEW", createdAt: created };
    for (const [orphans, stats] of [[{ orphans: [row] }, {}], [{}, () => Promise.reject(new Error("down"))]] as const) {
      const v = vault({ orphans, stats });
      const found = await findUnwoven(v.client, { drive: "d", select: "orphans" }, later());
      expect(found.size).toBe(0);
      expect(found.notes.map((n) => [n.id, n.title])).toEqual("orphans" in orphans ? [["o1", "o1"]] : []);
    }
  });

  it("counts the pipeline busy only from tasks it can date, and a queue with no tasks is idle", async () => {
    const t0 = later();
    const recent = new Date(t0 - 60_000).toISOString();
    const busy = async (tasks: unknown) => {
      const v = vault({ "notes/d": { state: { global: { nodes: [{ id: "q", documentType: "bai/pipeline-queue" }] } } }, "notes/q": { state: { global: tasks === undefined ? {} : { tasks } } }, orphans: [], stats: { noteCount: 1 } });
      return (await pollUnwoven(v.client, memoryStore(), { drive: "d", batch: 6, select: "orphans" }, () => t0), v.requests.some((r) => r.path === "orphans")) === false;
    };
    expect(await busy(undefined)).toBe(false);
    // Dated by when it was created when it was never updated.
    expect(await busy([{ taskType: "claim", status: "PENDING", createdAt: recent }])).toBe(true);
    // A task with no date at all holds nothing back.
    expect(await busy([{ taskType: "claim", status: "IN_PROGRESS" }])).toBe(false);
  });

  it("drops a damaged record of past tries instead of trusting it", async () => {
    const orphans = [{ documentId: "o1", title: "One", status: "IN_REVIEW", createdAt: created }];
    for (const record of ["garbage", ["o1"], { o1: { n: "1", at: 0, size: 0 }, o2: null }]) {
      const store = memoryStore(record);
      const v = vault({ "notes/d": { state: { global: { nodes: [] } } }, orphans, stats: { noteCount: 1 } });
      expect(await pollUnwoven(v.client, store, { drive: "d", batch: 6, select: "orphans" }, later)).toHaveLength(1);
      expect(store.values.get("knowledge-vault:unwoven-notes:tried")).toEqual({ o1: { n: 1, at: later(), size: 1 } });
    }
  });

  it("runs with the workflow's settings: a batch out of range is clamped, and the test shows the notes without recording a try", async () => {
    const orphans = Array.from({ length: 14 }, (_, i) => ({ documentId: `o${i}`, title: `Orphan ${i}`, status: "IN_REVIEW", createdAt: new Date(Date.parse(created) + i * 1000).toISOString() }));
    let empty = false;
    vi.stubGlobal("fetch", async (url: string | URL) => {
      const path = new URL(String(url)).pathname.replace(/^.*\/knowledge-note\//, "");
      if (path === "notes/d") return json({ state: { global: { nodes: [] } } });
      if (path === "orphans") return json(empty ? [] : orphans);
      if (path === "stats") return json({ noteCount: 14 });
      return new Response("{}", { status: 404 });
    });
    const auth = { type: "CUSTOM_AUTH", props: { base_url: "https://vault.test", token: "t0ken-for-tests" } };
    const store = memoryStore();
    const run = (batch: unknown, s = store) => unwovenNotesTrigger.run({ auth, propsValue: { drive: "d", batch }, store: s } as never) as Promise<{ count: number }[]>;
    expect((await run(30))[0].count).toBe(12);
    expect((await run("lots", memoryStore()))[0].count).toBe(6);
    expect((await run(0, memoryStore()))[0].count).toBe(6);

    const test = (batch: unknown) => unwovenNotesTrigger.test({ auth, propsValue: { drive: "d", batch, select: "orphans" }, store } as never) as Promise<{ count: number; note_ids: string }[]>;
    const [shown] = await test(2);
    expect(shown).toMatchObject({ count: 2, note_ids: "o0,o1" });
    empty = true;
    expect(await test(2)).toEqual([]);
  });

  it("leaves a note just written alone until it settles", async () => {
    const t0 = later();
    const v = vault({ orphans: [{ documentId: "fresh", status: "DRAFT", createdAt: new Date(t0 - SETTLE_MS / 2).toISOString() }], stats: { noteCount: 1 } });
    expect((await findUnwoven(v.client, { drive: "d", select: "orphans" }, t0)).notes).toEqual([]);
  });
});

describe("the reweave job at its edges", () => {
  it("takes note ids as a trigger hands them over: a list, text, a JSON array, or text that only looks like one", () => {
    expect(parseNoteIds(["a", " b ", 3, "a", ""])).toEqual(["a", "b"]);
    expect(parseNoteIds('["x","y"]')).toEqual(["x", "y"]);
    expect(parseNoteIds("[not json, z")).toEqual(["[not", "json", "z"]);
    expect(parseNoteIds(42)).toEqual([]);
    expect(parseNoteIds(null)).toEqual([]);
  });

  it("reads each note for what it lacks, leaving out what cannot be read or is not a note", async () => {
    const v = vault({
      "notes/gone": () => Promise.reject(new Error("404 not found")),
      "notes/map": { documentType: "bai/moc", state: { global: { title: "Map" } } },
      "notes/named": { name: "named-by-file", edges: [{ direction: "in" }, { direction: "in", linkType: "RELATES_TO" }] },
      "notes/bare": {},
    });
    const out = await readReweaveNotes(v.client, "d", ["gone", "map", "named", "bare"]);
    expect(out.skipped).toEqual([{ id: "gone", why: "could not be read: 404 not found" }, { id: "map", why: "is a bai/moc, not a note" }]);
    expect(out.notes.map((n) => [n.id, n.title, n.description, n.status, n.links, n.incoming, n.outgoing, n.placed, n.sourceId])).toEqual([
      ["named", "named-by-file", "", null, 1, 1, 0, false, null],
      ["bare", "bare", "", null, 0, 0, 0, false, null],
    ]);
  });

  it("with nothing it can reweave, says why and asks no model", async () => {
    const m = modelSays({});
    const v = vault({ "notes/gone": () => Promise.reject(new Error("404 not found")), "notes/d": { state: { global: { nodes: [] } } } });
    const run = (noteIds: string[]) => reweave(v.client, m.llm, "m", { drive: "d", noteIds, write: true }, stageRunner({}).stage, m.fetchImpl);
    expect((await run(["gone"])).summary).toBe("Nothing to reweave: gone could not be read: 404 not found.");
    expect((await run([])).summary).toBe("Nothing to reweave: no notes given.");
    expect(m.calls()).toBe(0);
  });

  it("leaves a note that lacks nothing alone, and finds no task to catch up in a vault without a queue", async () => {
    const m = modelSays({});
    const v = vault({
      "notes/fine": { documentType: "bai/knowledge-note", state: { global: { title: "Fine", status: "IN_REVIEW" } }, edges: [
        { direction: "in", documentId: "x", linkType: "RELATES_TO" }, { direction: "out", documentId: "y", linkType: "BUILDS_ON" }, { direction: "out", documentId: "z", linkType: "RELATES_TO" },
        { direction: "in", documentId: "m1", linkType: "CORE_IDEA" }, { direction: "out", documentId: "s1", linkType: "DERIVED_FROM" },
      ] },
      "notes/d": { state: { global: { nodes: [] } } },
    });
    const out = await reweave(v.client, m.llm, "m", { drive: "d", noteIds: ["fine"], write: true }, stageRunner({}).stage, m.fetchImpl);
    expect(out.summary).toBe("Reweaved 1 note: nothing was missing.");
    expect(m.calls()).toBe(0);
  });

  it("a dry run reports a new MoC for notes that share a theme, and a note no MoC fits", async () => {
    const placedNowhere = (id: string, title: string) => ({ documentType: "bai/knowledge-note", state: { global: { title, description: `${title}.`, status: "IN_REVIEW" } }, edges: [
      { direction: "in", documentId: "x", linkType: "RELATES_TO" }, { direction: "out", documentId: "y", linkType: "BUILDS_ON" }, { direction: "out", documentId: "z", linkType: "BUILDS_ON" },
    ] });
    const ids = ["p1", "p2", "p3", "p4"];
    const routes: Record<string, unknown> = Object.fromEntries(ids.map((id, i) => [`notes/${id}`, placedNowhere(id, `Data note ${i + 1}`)]));
    routes["graph.json"] = {
      nodes: [{ documentId: "hub", title: "Vault", noteType: "MOC (HUB)", status: "MOC" }, { documentId: "d1", title: "Models", description: "How models are trained", noteType: "MOC (DOMAIN)", status: "MOC" }],
      edges: [link("hub", "d1", "CHILD_MOC")],
    };
    const v = vault(routes);
    const plan = {
      placements: ["p1", "p2", "p3"].map((note) => ({ note, moc: "new:1" })),
      new_mocs: [{ key: "new:1", title: "Data quality", description: "What makes training data good.", orientation: "Start with p1.", parent: "d1" }],
    };
    const m = modelSays(plan);
    const out = await reweave(v.client, m.llm, "m", { drive: "d", noteIds: ids, write: false }, stageRunner({}).stage, m.fetchImpl);
    expect(out.summary).toBe('Dry run: Reweaved 4 notes: 3 notes would go to "new: Data quality"; 1 note still in no MoC (none fits yet; the note is tried again once the vault has grown).');
    expect(out.new_mocs).toEqual([{ title: "Data quality", parent_title: "Models" }]);
    expect(out.unplaced).toEqual(["Data note 4"]);
    expect(v.requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("reports a link the vault refuses, and catches up no task when the queue holds none", async () => {
    const reason = "The thin note's claim is one instance of the older note's rule about budgets.";
    const v = vault({
      "notes/t17/similar": [{ similarity: 0.9, node: { documentId: "o42", title: "Budgets follow capital", description: "", status: "CANONICAL" } }],
      "notes/t17": { documentType: "bai/knowledge-note", state: { global: { title: "Thin", status: "IN_REVIEW" } }, edges: [
        { direction: "in", documentId: "x", linkType: "RELATES_TO" }, { direction: "in", documentId: "m1", linkType: "CORE_IDEA" }, { direction: "out", documentId: "s1", linkType: "DERIVED_FROM" },
      ] },
      "notes/d": { state: { global: { nodes: [{ id: "q", documentType: "bai/pipeline-queue" }] } } },
      "notes/q": { state: { global: {} } },
      relationships: () => Promise.reject(new Error("Forbidden: insufficient permissions")),
    });
    const m = modelSays({ links: [{ from: "t17", to: "o42", type: "BUILDS_ON", reason, confidence: "grounded" }] });
    const out = await reweave(v.client, m.llm, "m", { drive: "d", noteIds: ["t17"], write: true }, stageRunner({}).stage, m.fetchImpl);
    expect(out.summary).toBe("Reweaved 1 note: 0 links written (1 refused by the vault).");
    expect(out.links).toMatchObject([{ from_title: "Thin", to_title: "Budgets follow capital" }]);
    expect(v.requests.filter((r) => r.path === "tasks/reconcile")).toEqual([]);
  });
});
