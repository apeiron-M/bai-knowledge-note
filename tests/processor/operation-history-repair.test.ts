/**
 * An index written before change history, as it really is: document-scope
 * operations stored under the `<doc>-<index>` id of the global operation with
 * the same number (so the first global operations were dropped), and no
 * source operations at all. The migration repairs the ids; the backfill with
 * `all` refills the missing global rows; the digest then reads the right
 * baselines.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import { createTestDb } from "../helpers/create-test-db.js";
import { up } from "../../processors/graph-indexer/migrations.js";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";
import { backfillOperationHistory, type SourceOp, type SourceOpReader } from "../../processors/graph-indexer/source-history-backfill.js";
import { SOURCE_ROW_VERSION } from "../../processors/graph-indexer/source-timeline.js";
import { operationRowOf } from "../../processors/graph-indexer/operation-row.js";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const T = "2026-11-01T00:00:00.000Z";

function oldRow(id: string, documentId: string, scope: string, index: number, type: string, input: unknown, timestamp: string, documentType = "bai/knowledge-note") {
  return {
    id,
    document_id: documentId,
    document_type: documentType,
    operation_type: type,
    timestamp,
    index,
    scope,
    summary: null,
    input_json: JSON.stringify(input),
    signer_address: null,
    signer_app: null,
    signer_key: null,
    signature: null,
  };
}

/** The reactor's global logs for the documents of this index. */
const LOGS: Record<string, SourceOp[]> = {
  n1: [
    { index: 0, type: "SET_TITLE", input: { title: "Read models fold operations" }, timestampUtcMs: "2026-08-01T00:00:01.000Z" },
    { index: 1, type: "SET_DESCRIPTION", input: { description: "How read models work" }, timestampUtcMs: "2026-08-01T00:00:02.000Z" },
    { index: 2, type: "SET_CONTENT", input: { content: "old body" }, timestampUtcMs: "2026-08-01T00:00:03.000Z" },
    { index: 3, type: "SET_TITLE", input: { title: "Read models fold operations in order" }, timestampUtcMs: "2026-11-03T10:00:00.000Z" },
  ],
  s1: [
    { index: 0, type: "INGEST_SOURCE", input: { title: "Guide", content: "a\nb", method: "sha256:1 git:v6.2.2-dev.74" }, timestampUtcMs: "2026-08-01T00:00:00.000Z" },
    { index: 1, type: "ATTACH_ORIGINAL_FILE", input: {}, timestampUtcMs: "2026-08-01T00:00:01.000Z" },
    { index: 2, type: "INGEST_SOURCE", input: { title: "Guide", content: "a\nc", method: "sha256:2 git:v6.2.3-dev.91+e0f277d" }, timestampUtcMs: "2026-11-03T11:00:00.000Z" },
  ],
};

const reader: SourceOpReader = {
  async *operations(documentId, actionTypes) {
    for (const op of LOGS[documentId] ?? []) if (!actionTypes || actionTypes.includes(op.type)) yield op;
  },
};

const WINDOW = { since: "2026-11-03T00:00:00.000Z", until: "2026-11-03T23:59:59.999Z" };

describe("an index recorded before change history", () => {
  let harness: TestDb;
  beforeEach(async () => {
    harness = await createTestDb();
    const db = harness.db;
    await db
      .insertInto("graph_nodes")
      .values({ id: "n1", document_id: "n1", title: "Read models fold operations in order", description: null, note_type: null, status: "CANONICAL", content: null, author: null, source_origin: null, created_at: null, added_at: null, updated_at: T, document_type: "bai/knowledge-note" })
      .execute();
    await db
      .insertInto("graph_sources")
      .values({ document_id: "s1", row_json: JSON.stringify({ id: "s1", title: "Guide", claimIds: [], addedAt: "2026-08-01T00:00:00.000Z" }), revision: 3, version: SOURCE_ROW_VERSION, updated_at: T })
      .execute();
    await db
      .insertInto("graph_operations")
      .values([
        // The collision: document-scope CREATE/UPGRADE took the global ids, so global 0 and 1 were dropped.
        oldRow("n1-0", "n1", "document", 0, "CREATE_DOCUMENT", {}, "2026-08-01T00:00:00.000Z"),
        oldRow("n1-1", "n1", "document", 1, "UPGRADE_DOCUMENT", {}, "2026-08-01T00:00:00.500Z"),
        oldRow("n1-2", "n1", "global", 2, "SET_CONTENT", { content: "old body" }, "2026-08-01T00:00:03.000Z"),
        oldRow("n1-3", "n1", "global", 3, "SET_TITLE", { title: "Read models fold operations in order" }, "2026-11-03T10:00:00.000Z"),
        // A link row already carries its scope.
        oldRow("n1-document-2", "n1", "document", 2, "ADD_RELATIONSHIP", { sourceId: "n1", targetId: "n9", relationshipType: "RELATES_TO" }, "2026-08-01T00:00:04.000Z"),
        // A replay after the id change already wrote the scoped twin of n2-0.
        oldRow("n2-0", "n2", "document", 0, "CREATE_DOCUMENT", {}, "2026-08-02T00:00:00.000Z"),
        oldRow("n2-document-0", "n2", "document", 0, "CREATE_DOCUMENT", {}, "2026-08-02T00:00:00.000Z"),
        // The source's re-ingest arrived live; its first ingestion never was recorded.
        oldRow("s1-2", "s1", "global", 2, "INGEST_SOURCE", LOGS.s1[2].input, "2026-11-03T11:00:00.000Z", "bai/source"),
      ])
      .execute();
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  it("moves document-scope rows to their scoped id, keeping one row per operation, idempotently", async () => {
    await up(harness.db as unknown as IRelationalDb<DB>);
    await up(harness.db as unknown as IRelationalDb<DB>);
    const rows = await harness.db.selectFrom("graph_operations").select(["id", "operation_type"]).orderBy("id").execute();
    expect(rows).toEqual([
      { id: "n1-2", operation_type: "SET_CONTENT" },
      { id: "n1-3", operation_type: "SET_TITLE" },
      { id: "n1-document-0", operation_type: "CREATE_DOCUMENT" },
      { id: "n1-document-1", operation_type: "UPGRADE_DOCUMENT" },
      { id: "n1-document-2", operation_type: "ADD_RELATIONSHIP" },
      { id: "n2-document-0", operation_type: "CREATE_DOCUMENT" },
      { id: "s1-2", operation_type: "INGEST_SOURCE" },
    ]);
  });

  it("before the backfill, a re-ingested source says its earlier version was not recorded", async () => {
    await up(harness.db as unknown as IRelationalDb<DB>);
    const d = await createGraphQuery(harness.db).changes(WINDOW, { documentIds: ["s1"] }, {});
    expect(d.events?.[0]).toMatchObject({ kind: "source-revised", significance: 3, source: { added: null, removed: null, refBefore: null } });
  });

  it("after the migration and a full backfill, baselines are the values before the window", async () => {
    await up(harness.db as unknown as IRelationalDb<DB>);
    const result = await backfillOperationHistory(reader, harness.db, [
      { documentId: "n1", documentType: "bai/knowledge-note" },
      { documentId: "s1", documentType: "bai/source" },
    ]);
    // n1: global 0 and 1 were dropped; s1: its first ingestion was never recorded.
    expect(result).toEqual({ sources: 1, documents: 1, inserted: 3, skipped: 3, errors: [] });
    const again = await backfillOperationHistory(reader, harness.db, [
      { documentId: "n1", documentType: "bai/knowledge-note" },
      { documentId: "s1", documentType: "bai/source" },
    ]);
    expect(again.inserted).toBe(0);

    const ids = (await harness.db.selectFrom("graph_operations").select("id").where("document_id", "=", "n1").orderBy("id").execute()).map((r) => r.id);
    expect(ids).toEqual(["n1-0", "n1-1", "n1-2", "n1-3", "n1-document-0", "n1-document-1", "n1-document-2"]);

    const d = await createGraphQuery(harness.db).changes(WINDOW, { documentIds: ["n1", "s1"] }, {});
    const note = d.events?.find((e) => e.documentId === "n1");
    expect(note).toMatchObject({ kind: "revised", fields: { title: { before: "Read models fold operations", after: "Read models fold operations in order" } } });
    const source = d.events?.find((e) => e.documentId === "s1");
    expect(source).toMatchObject({ kind: "source-revised", source: { refBefore: "v6.2.2-dev.74", refAfter: "v6.2.3-dev.91+e0f277d", added: 1, removed: 1 } });
    expect(d.totals.operations).toBe(2);
  });
});

describe("history timestamps", () => {
  let harness: TestDb;
  beforeEach(async () => {
    harness = await createTestDb();
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  it("are written as ISO with milliseconds, whatever the operation carried", () => {
    const at = (timestampUtcMs: string) => operationRowOf({ documentId: "n", documentType: "bai/knowledge-note", index: 0, type: "SET_TITLE", input: {}, timestampUtcMs }).timestamp;
    expect(at("2026-11-03T10:00:00Z")).toBe("2026-11-03T10:00:00.000Z");
    expect(at("1762164000000")).toBe("2025-11-03T10:00:00.000Z");
    expect(at("2026-11-03T10:00:00.123Z")).toBe("2026-11-03T10:00:00.123Z");
    expect(at("garbage")).toBe("garbage");
  });

  it("already stored are normalised by the migration, so string order is time order", async () => {
    await harness.db
      .insertInto("graph_operations")
      .values([
        oldRow("a", "n1", "global", 0, "SET_TITLE", {}, "2026-11-03T23:59:59Z"),
        oldRow("b", "n1", "global", 1, "SET_TITLE", {}, "1762164000000"),
        oldRow("c", "n1", "global", 2, "SET_TITLE", {}, "2026-11-03T10:00:00.000Z"),
        oldRow("d", "n1", "global", 3, "SET_TITLE", {}, "not a time"),
      ])
      .execute();
    await up(harness.db as unknown as IRelationalDb<DB>);
    const rows = await harness.db.selectFrom("graph_operations").select(["id", "timestamp"]).orderBy("id").execute();
    expect(rows).toEqual([
      { id: "a", timestamp: "2026-11-03T23:59:59.000Z" },
      { id: "b", timestamp: "2025-11-03T10:00:00.000Z" },
      { id: "c", timestamp: "2026-11-03T10:00:00.000Z" },
      { id: "d", timestamp: "not a time" },
    ]);
  });
});
