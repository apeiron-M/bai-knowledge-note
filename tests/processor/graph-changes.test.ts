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
    const fromDb = await createGraphQuery(db).changes(f.window, scope, { limit: 200 });

    // The index holds no source folder; everything else is the fixture's context.
    const ctx = fixtureContext();
    for (const [id, s] of ctx.sources) ctx.sources.set(id, { ...s, folder: null });
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
