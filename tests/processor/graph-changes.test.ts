/**
 * The change digest's query layer: `createGraphQuery(db).changes()` reads
 * `graph_operations` and the graph context, and hands them to the pure
 * `buildChanges` — so on the same rows the two must agree exactly.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../helpers/create-test-db.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";
import { buildChanges, type OperationRow } from "../../processors/graph-indexer/changes.js";
import { SOURCE_ROW_VERSION } from "../../processors/graph-indexer/source-timeline.js";
import { fixtureContext, loadChangesFixture } from "../fixtures/changes/load.js";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const T = "2026-11-01T00:00:00.000Z";

async function insertOps(db: TestDb["db"], rows: OperationRow[], prefix = "r"): Promise<void> {
  const values = rows.map((r, i) => ({
    id: `${prefix}${i}`,
    document_id: r.documentId,
    document_type: r.documentType,
    operation_type: r.operationType,
    timestamp: r.timestamp,
    index: r.index,
    scope: "global",
    summary: null,
    input_json: r.inputJson,
    signer_address: r.signerAddress,
    signer_app: null,
    signer_key: null,
    signature: null,
  }));
  for (let i = 0; i < values.length; i += 500) await db.insertInto("graph_operations").values(values.slice(i, i + 500)).execute();
}

async function insertNode(db: TestDb["db"], id: string, title: string, documentType = "bai/knowledge-note", noteType: string | null = null): Promise<void> {
  await db
    .insertInto("graph_nodes")
    .values({
      id,
      document_id: id,
      title,
      description: null,
      note_type: noteType,
      status: documentType === "bai/moc" ? "MOC" : "CANONICAL",
      content: null,
      author: null,
      source_origin: null,
      created_at: null,
      added_at: null,
      updated_at: T,
      document_type: documentType,
    })
    .onConflict((oc) => oc.column("document_id").doNothing())
    .execute();
}

async function insertEdge(db: TestDb["db"], source: string, target: string, type: string, reason?: string): Promise<void> {
  await db
    .insertInto("graph_edges")
    .values({
      id: `${source}-${target}-${type}`,
      source_document_id: source,
      target_document_id: target,
      link_type: type,
      target_title: null,
      updated_at: T,
      metadata: reason ? JSON.stringify({ reason }) : null,
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
}

async function insertSource(db: TestDb["db"], id: string, title: string, claimIds: string[], addedAt: string | null): Promise<void> {
  await db
    .insertInto("graph_sources")
    .values({ document_id: id, row_json: JSON.stringify({ id, title, claimIds, addedAt }), revision: 1, version: SOURCE_ROW_VERSION, updated_at: T })
    .execute();
}

describe("graph query: changes()", () => {
  let harness: TestDb;
  beforeEach(async () => {
    harness = await createTestDb();
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  it("returns what buildChanges returns on the same rows (the recorded 2026-11-03 sync)", async () => {
    const f = loadChangesFixture();
    const db = harness.db;
    await insertOps(db, f.rows, "w");
    await insertOps(db, f.baseline, "b");
    // Maps first, with their tier: a fixture node row for the same map carries none.
    for (const m of f.context.mocsByNote) await insertNode(db, m.id, m.title, "bai/moc", `MOC (${m.tier})`);
    for (const n of f.context.nodes) await insertNode(db, n.id, n.title, n.documentType);
    for (const n of f.context.nodes) for (const t of n.topics) await db.insertInto("graph_topics").values({ id: `${n.id}-${t}`, document_id: n.id, name: t, updated_at: T }).execute();
    for (const m of f.context.mocsByNote) {
      await insertEdge(db, m.id, m.noteId, "CORE_IDEA");
    }
    for (const d of f.context.derivedFrom) for (const s of d.sourceIds) await insertEdge(db, d.noteId, s, "DERIVED_FROM");
    for (const e of f.context.edges) if (e.type === "SUPERSEDES") await insertEdge(db, e.source, e.target, e.type, e.reason);
    for (const s of f.context.sources) await insertSource(db, s.id, s.title, s.claimIds, s.addedAt);

    const ids = [...new Set(f.rows.map((r) => r.documentId))].sort();
    const scope = { documentIds: ids };
    // Source folders come from the drive tree (the subgraph passes them in).
    const sourceFolders = new Map(f.context.sources.filter((s) => s.folder).map((s) => [s.id, s.folder as string]));
    const fromDb = await createGraphQuery(db).changes(f.window, scope, { limit: 200, sourceFolders });

    const ctx = fixtureContext();
    const pure = buildChanges(f.rows, f.baseline, ctx, f.window, { scope, limit: 200 });

    expect(fromDb.totals).toEqual(pure.totals);
    expect(fromDb.groups).toEqual(pure.groups);
    expect(fromDb.events).toEqual(pure.events);
    expect(fromDb.totals.revised).toBeGreaterThan(0);
  });

  it("scopes a map to its notes, its child maps' notes and their sources", async () => {
    const db = harness.db;
    await insertNode(db, "m1", "Processors", "bai/moc", "MOC (DOMAIN)");
    await insertNode(db, "m2", "Read models", "bai/moc", "MOC (TOPIC)");
    await insertEdge(db, "m1", "m2", "CHILD_MOC");
    await insertEdge(db, "m1", "n1", "CORE_IDEA");
    await insertEdge(db, "m2", "n2", "CORE_IDEA");
    await insertEdge(db, "n2", "s1", "DERIVED_FROM");
    await insertSource(db, "s1", "Guide", ["n2"], "2026-08-01T00:00:00.000Z");
    await insertSource(db, "s2", "Unrelated", ["n3"], "2026-08-01T00:00:00.000Z");
    for (const id of ["n1", "n2", "n3"]) await insertNode(db, id, id.toUpperCase());
    const at = "2026-11-03T10:00:00.000Z";
    await insertOps(db, [
      { documentId: "n1", documentType: "bai/knowledge-note", operationType: "SET_TITLE", timestamp: at, index: 1, inputJson: '{"title":"N1"}', signerAddress: null },
      { documentId: "n2", documentType: "bai/knowledge-note", operationType: "SET_TITLE", timestamp: at, index: 1, inputJson: '{"title":"N2"}', signerAddress: null },
      { documentId: "n3", documentType: "bai/knowledge-note", operationType: "SET_TITLE", timestamp: at, index: 1, inputJson: '{"title":"N3"}', signerAddress: null },
      { documentId: "s1", documentType: "bai/source", operationType: "INGEST_SOURCE", timestamp: at, index: 4, inputJson: '{"title":"Guide","content":"a"}', signerAddress: null },
      { documentId: "s2", documentType: "bai/source", operationType: "INGEST_SOURCE", timestamp: at, index: 4, inputJson: '{"title":"Unrelated","content":"a"}', signerAddress: null },
    ]);
    const window = { since: "2026-11-03T00:00:00.000Z", until: "2026-11-03T23:59:59.999Z" };
    const d = await createGraphQuery(db).changes(window, { moc: "m1" }, {});
    expect(d.events?.map((e) => e.documentId).sort()).toEqual(["n1", "n2", "s1"]);
    expect(d.scope).toEqual({ moc: "m1" });
    expect(d.groups.map((g) => g.title).sort()).toEqual(["Processors", "Read models"]);
  });

  it("reads a map's baseline from CREATE_MOC, and drops a supersession taken back by a note outside the scope", async () => {
    const db = harness.db;
    await insertNode(db, "m1", "Processors", "bai/moc", "MOC (TOPIC)");
    const op = (documentId: string, documentType: string, operationType: string, input: unknown, timestamp: string): OperationRow => ({ documentId, documentType, operationType, timestamp, index: 0, inputJson: JSON.stringify(input), signerAddress: null });
    await insertOps(db, [
      op("m1", "bai/moc", "CREATE_MOC", { title: "Processors", description: "first words", orientation: "", tier: "TOPIC" }, "2026-08-01T00:00:00.000Z"),
      op("m1", "bai/moc", "UPDATE_DESCRIPTION", { description: "second words" }, "2026-11-03T01:00:00.000Z"),
      op("x", "bai/knowledge-note", "ADD_RELATIONSHIP", { sourceId: "x", targetId: "n1", relationshipType: "SUPERSEDES" }, "2026-11-03T01:00:00.000Z"),
      op("x", "bai/knowledge-note", "REMOVE_RELATIONSHIP", { sourceId: "x", targetId: "n1" }, "2026-11-03T02:00:00.000Z"),
      op("n1", "bai/knowledge-note", "ADD_TOPIC", { name: "t" }, "2026-11-03T03:00:00.000Z"),
    ]);
    const window = { since: "2026-11-03T00:00:00.000Z", until: "2026-11-03T23:59:59.999Z" };
    const d = await createGraphQuery(db).changes(window, { documentIds: ["m1", "n1"] }, {});
    expect(d.events?.map((e) => [e.documentId, e.kind])).toEqual([["m1", "revised"]]);
    expect(d.events?.[0].fields?.description).toEqual({ before: "first words", after: "second words" });
    expect(d.groups.map((g) => g.key)).toEqual(["moc:m1"]);
  });

  it("tells the knowledge story: hub areas, then-titles, archived-at-since, incoming edges, and then vs now for q", async () => {
    const db = harness.db;
    const node = async (id: string, title: string, documentType: string, extra: { noteType?: string; status?: string; description?: string; addedAt?: string } = {}) =>
      db
        .insertInto("graph_nodes")
        .values({
          id,
          document_id: id,
          title,
          description: extra.description ?? null,
          note_type: extra.noteType ?? null,
          status: extra.status ?? (documentType === "bai/moc" ? "MOC" : "CANONICAL"),
          content: null,
          author: null,
          source_origin: null,
          created_at: null,
          added_at: extra.addedAt ?? "2026-08-01T00:00:00.000Z",
          updated_at: T,
          document_type: documentType,
        })
        .execute();
    await node("hub", "Powerhouse", "bai/moc", { noteType: "MOC (HUB)" });
    await node("a1", "Processors", "bai/moc", { noteType: "MOC (DOMAIN)" });
    await node("m1", "Delivery", "bai/moc", { noteType: "MOC (TOPIC)" });
    await node("n1", "Delivery is at-least-once, with a crash gap", "bai/knowledge-note");
    await node("n2", "Processors poll", "bai/knowledge-note", { status: "ARCHIVED" });
    await node("n3", "Processors checkpoint per batch", "bai/knowledge-note", { addedAt: "2026-11-03T05:00:00.000Z", description: "gist" });
    await node("n4", "Other", "bai/knowledge-note");
    await insertEdge(db, "hub", "a1", "CHILD_MOC");
    await insertEdge(db, "a1", "m1", "CHILD_MOC");
    await insertEdge(db, "m1", "n1", "CORE_IDEA");
    await insertEdge(db, "a1", "n2", "CORE_IDEA");
    await insertEdge(db, "m1", "n3", "CORE_IDEA");
    await insertEdge(db, "n4", "n3", "RELATES_TO");
    const op = (documentId: string, operationType: string, input: unknown, timestamp: string, index = 0): OperationRow => ({ documentId, documentType: "bai/knowledge-note", operationType, timestamp, index, inputJson: JSON.stringify(input), signerAddress: null });
    await insertOps(db, [
      op("n1", "SET_TITLE", { title: "Delivery is exactly once, in order" }, "2026-08-01T00:00:00.000Z", 2),
      op("n2", "ARCHIVE_NOTE", {}, "2026-10-01T00:00:00.000Z", 3),
      op("n1", "SET_TITLE", { title: "Delivery is at-least-once, with a crash gap" }, "2026-11-03T01:00:00.000Z", 5),
      op("n3", "CREATE_DOCUMENT", {}, "2026-11-03T05:00:00.000Z", 0),
    ]);
    const window = { since: "2026-11-03T00:00:00.000Z", until: "2026-11-03T23:59:59.999Z" };
    const d = await createGraphQuery(db).changes(window, {}, {});
    expect(d.thenVsNow).toBeUndefined();
    expect(d.story?.growth).toMatchObject({ notesThen: 2, notesNow: 3 });
    expect(d.story?.areas).toEqual([
      {
        id: "a1",
        title: "Processors",
        notesThen: 1,
        notesNow: 2,
        newCount: 1,
        changedCount: 1,
        retiredCount: 0,
        mergedCount: 0,
        newClaims: [{ documentId: "n3", claim: "Processors checkpoint per batch", gist: "gist" }],
        changedClaims: [
          {
            documentId: "n1",
            then: { claim: "Delivery is exactly once, in order", gist: null },
            now: { claim: "Delivery is at-least-once, with a crash gap", gist: null },
            why: null,
          },
        ],
        retiredClaims: [],
      },
    ]);

    const q = await createGraphQuery(db).changes(window, { q: "processor delivery", documentIds: ["n1", "n2", "n3"] }, {});
    expect(q.thenVsNow).toEqual({
      then: [{ documentId: "n1", claim: "Delivery is exactly once, in order", gist: null }],
      now: [
        { documentId: "n3", claim: "Processors checkpoint per batch", gist: "gist" },
        { documentId: "n1", claim: "Delivery is at-least-once, with a crash gap", gist: null },
      ],
      unchanged: [],
    });
  });

  it("reads a created note's first recorded state and the revision lines added since, and its area's source versions", async () => {
    const db = harness.db;
    await insertNode(db, "hub", "Powerhouse", "bai/moc", "MOC (HUB)");
    await insertNode(db, "a1", "Processors", "bai/moc", "MOC (DOMAIN)");
    await insertNode(db, "n1", "Delivery is at-least-once, with a crash gap");
    await insertEdge(db, "hub", "a1", "CHILD_MOC");
    await insertEdge(db, "a1", "n1", "CORE_IDEA");
    await insertEdge(db, "n1", "s1", "DERIVED_FROM");
    const op = (operationType: string, input: unknown, timestamp: string, index: number): OperationRow => ({ documentId: "n1", documentType: "bai/knowledge-note", operationType, timestamp, index, inputJson: JSON.stringify(input), signerAddress: null });
    await insertOps(db, [
      op("CREATE_DOCUMENT", {}, "2026-09-02T10:00:00.000Z", 0),
      op("SET_TITLE", { title: "Delivery is exactly once, in order" }, "2026-09-02T10:00:05.000Z", 1),
      op("SET_CONTENT", { content: "body\n\n## Revision history\n- v6.2.2-dev.74 (2026-09-02): first" }, "2026-09-02T10:00:06.000Z", 2),
      op("SET_TITLE", { title: "Delivery is at-least-once, with a crash gap" }, "2026-11-03T10:00:00.000Z", 3),
      op("SET_CONTENT", { content: "body2\n\n## Revision history\n- v6.2.2-dev.74 (2026-09-02): first\n- v6.2.3-dev.91 (2026-11-03): outbox replays" }, "2026-11-03T10:00:01.000Z", 4),
    ]);
    const ingest = (id: string, timestamp: string, ref: string, index: number) => ({
      id, document_id: "s1", document_type: "bai/source", operation_type: "INGEST_SOURCE", timestamp, index, scope: "global",
      summary: `Ingested “Processors (guide)” (${ref})`, input_json: JSON.stringify({ title: "Processors (guide)", content: "x", method: `sha256:abc git:${ref}` }),
      signer_address: null, signer_app: null, signer_key: null, signature: null,
    });
    await db.insertInto("graph_operations").values([
      ingest("i1", "2026-09-02T09:00:00.000Z", "v6.2.2-dev.74", 0),
      ingest("i2", "2026-11-03T09:00:00.000Z", "v6.2.3-dev.91+e0f277d", 1),
    ]).execute();
    const d = await createGraphQuery(db).changes({ since: "2026-09-01T00:00:00.000Z", until: "2026-11-04T00:00:00.000Z" }, {}, {});
    const area = d.story?.areas.find((a) => a.id === "a1");
    expect(area?.changedClaims).toEqual([
      {
        documentId: "n1",
        then: { claim: "Delivery is exactly once, in order", gist: null },
        now: { claim: "Delivery is at-least-once, with a crash gap", gist: null },
        why: "v6.2.3-dev.91 (2026-11-03): outbox replays",
        thenAt: "2026-09-02T10:00:05.000Z",
      },
    ]);
    expect(area?.newClaims.map((c) => c.documentId)).toEqual(["n1"]);
    expect(area?.versions).toEqual({ first: "v6.2.2-dev.74", now: "v6.2.3-dev.91+e0f277d" });
  });

  it("lists the hub's areas and their descendant maps with depth, for a query to name a map", async () => {
    const db = harness.db;
    await insertNode(db, "hub", "Powerhouse", "bai/moc", "MOC (HUB)");
    await insertNode(db, "a1", "Data Processing and CQRS", "bai/moc", "MOC (DOMAIN)");
    await insertNode(db, "m1", "Processors", "bai/moc", "MOC (TOPIC)");
    await insertNode(db, "x", "Loose map", "bai/moc", "MOC (TOPIC)");
    await insertEdge(db, "hub", "a1", "CHILD_MOC");
    await insertEdge(db, "a1", "m1", "CHILD_MOC");
    await insertEdge(db, "m1", "a1", "CHILD_MOC"); // a cycle is walked once
    const maps = await createGraphQuery(db).changeMaps();
    expect(maps).toEqual([
      { id: "a1", title: "Data Processing and CQRS", depth: 1 },
      { id: "m1", title: "Processors", depth: 2 },
    ]);
  });

  it("answers a sync-sized window — large sources and notes with baselines — in seconds, not minutes", async () => {
    const db = harness.db;
    const before = "2026-10-01T00:00:00.000Z";
    const during = (i: number) => new Date(Date.parse("2026-11-03T01:00:00.000Z") + i * 1000).toISOString();
    // A source like the monorepo's: ~1,500 lines, a few hundred changed between refs.
    const sourceText = (s: number, v: number) =>
      Array.from({ length: 1500 }, (_, l) => (l % 7 === 0 && v === 2 ? `revised ${s}:${l} ${"y".repeat(30)}` : `line ${s}:${l} ${"x".repeat(30)}`)).join("\n");
    const noteBody = (n: number, v: number) => Array.from({ length: 60 }, (_, l) => (l % 10 === 0 && v === 2 ? `edited ${n}:${l}` : `claim ${n}:${l} ${"z".repeat(40)}`)).join("\n");
    const rows: OperationRow[] = [];
    for (let s = 0; s < 300; s++) {
      for (const [v, at] of [[1, before], [2, during(s)]] as const) {
        rows.push({ documentId: `s${s}`, documentType: "bai/source", operationType: "INGEST_SOURCE", timestamp: at, index: v, inputJson: JSON.stringify({ title: `Source ${s}`, content: sourceText(s, v), method: `git:v${v}` }), signerAddress: null });
      }
      // Re-ingested twice in the window, so the first and last ingestion both count.
      rows.push({ documentId: `s${s}`, documentType: "bai/source", operationType: "INGEST_SOURCE", timestamp: during(s + 1), index: 3, inputJson: JSON.stringify({ title: `Source ${s}`, content: sourceText(s, 2), method: "git:v3" }), signerAddress: null });
    }
    for (let n = 0; n < 1000; n++) {
      rows.push({ documentId: `n${n}`, documentType: "bai/knowledge-note", operationType: "SET_CONTENT", timestamp: before, index: 0, inputJson: JSON.stringify({ content: noteBody(n, 1) }), signerAddress: null });
      for (let k = 0; k < 3; k++) rows.push({ documentId: `n${n}`, documentType: "bai/knowledge-note", operationType: "SET_CONTENT", timestamp: during(n * 3 + k), index: 1 + k, inputJson: JSON.stringify({ content: noteBody(n, k === 2 ? 2 : 1) }), signerAddress: null });
    }
    for (let i = 0; i < 300; i++) await insertSource(db, `s${i}`, `Source ${i}`, Array.from({ length: 40 }, (_, k) => `n${(i * 3 + k) % 1000}`), "2026-08-01T00:00:00.000Z");
    await insertOps(db, rows);

    const window = { since: "2026-11-03T00:00:00.000Z", until: "2026-11-04T00:00:00.000Z" };
    const started = performance.now();
    const summary = await createGraphQuery(db).changes(window, {}, {});
    const page = await createGraphQuery(db).changes(window, { types: ["bai/source"], documentIds: Array.from({ length: 300 }, (_, i) => `s${i}`) }, { limit: 50 });
    const elapsed = performance.now() - started;

    expect(summary.totals).toMatchObject({ revised: 1000, sourcesRevised: 300 });
    expect(page.events).toHaveLength(50);
    const e = page.events?.[0];
    expect(e?.source).toMatchObject({ refBefore: "v1", refAfter: "v3", added: 215, removed: 215 });
    expect(e?.source?.hunks.length).toBeGreaterThan(0);
    // Measured: ~0.8 s here, against ~16 s when every event was LCS-diffed
    // and every body read. Events past the page are counted, not diffed.
    expect(elapsed).toBeLessThan(3000);
  }, 120_000);

  it("answers a window of 20,000 operations in under two seconds", async () => {
    const db = harness.db;
    const rows: OperationRow[] = [];
    const types = ["ADD_RELATIONSHIP", "SET_METADATA_FIELD", "ADD_TOPIC", "APPROVE_NOTE", "SET_CONTENT"];
    for (let i = 0; i < 20_000; i++) {
      const doc = `n${i % 1000}`;
      const type = types[Math.floor(i / 1000) % types.length];
      const input =
        type === "SET_CONTENT"
          ? { content: `claim ${i}\n${"body line\n".repeat(20)}` }
          : type === "SET_METADATA_FIELD"
            ? { field: i % 2 ? "version" : "filePath", value: `v${i}` }
            : type === "ADD_RELATIONSHIP"
              ? { sourceId: doc, targetId: `n${(i + 1) % 1000}`, relationshipType: "RELATES_TO", metadata: { reason: "x".repeat(200) } }
              : { name: "t" };
      rows.push({
        documentId: doc,
        documentType: "bai/knowledge-note",
        operationType: type,
        timestamp: new Date(Date.parse("2026-11-03T00:00:00.000Z") + i * 1000).toISOString(),
        index: i,
        inputJson: JSON.stringify(input),
        signerAddress: "0xabc",
      });
    }
    await insertOps(db, rows);
    const started = performance.now();
    const d = await createGraphQuery(db).changes({ since: "2026-11-03T00:00:00.000Z", until: "2026-11-04T00:00:00.000Z" }, {}, {});
    const elapsed = performance.now() - started;
    expect(d.totals.operations).toBe(20_000);
    expect(d.totals.documents).toBe(1000);
    expect(elapsed).toBeLessThan(2000);
  }, 60_000);
});
