/**
 * The index keeps a small row per source document (`graph_sources`), so the
 * source timeline reads one table instead of every source in full — chapter
 * text and all — on each refresh. Sources stay out of the graph itself: no
 * node, no activity.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import type { OperationWithContext } from "@powerhousedao/shared/document-model";
import { up } from "../../processors/graph-indexer/migrations.js";
import { createTestDb } from "../helpers/create-test-db.js";
import { makeOp } from "../helpers/make-op.js";
import { GraphIndexerProcessor } from "../../processors/graph-indexer/index.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";
import type { DB } from "../../processors/graph-indexer/schema.js";

vi.mock("../../processors/graph-indexer/embedder.js", () => ({
  generateEmbedding: () => Promise.resolve(new Array(384).fill(0) as number[]),
}));

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

function sourceOperation(o: { documentId: string; status: string; index?: number; timestampUtcMs: string; claims?: string[] }): OperationWithContext {
  const entry = makeOp({ documentId: o.documentId, documentType: "bai/source", actionType: "SET_SOURCE_STATUS", actionInput: { status: o.status }, index: o.index ?? 0 });
  const state = {
    header: { id: o.documentId, name: "chapter-1", createdAtUtcIso: "2026-10-15T19:04:00.000Z", revision: { global: (o.index ?? 0) + 1 } },
    global: {
      title: "Chapter 1",
      content: "A very long chapter. ".repeat(500),
      status: o.status,
      sourceType: "BOOK_CHAPTER",
      createdAt: "2026-10-15T19:04:00.000Z",
      createdBy: "0x1234567890abcdef1234567890abcdef12345678",
      provenance: { method: "converted", tool: "docling.rs", url: null },
      originalFileName: "Machine-Learning-Systems-Vol1.pdf",
      originalMimeType: "application/pdf",
      originalSizeBytes: 12_197_035,
      extractedClaims: o.claims ?? [],
    },
  };
  return {
    ...entry,
    operation: { ...entry.operation, timestampUtcMs: o.timestampUtcMs },
    context: { ...entry.context, resultingState: JSON.stringify(state) },
  } as OperationWithContext;
}

describe("graph_sources: a small row per source", () => {
  let harness: TestDb;
  let processor: InstanceType<typeof GraphIndexerProcessor>;

  beforeEach(async () => {
    harness = await createTestDb();
    processor = new GraphIndexerProcessor(
      "test",
      { branch: ["main"], documentId: ["*"], documentType: ["bai/knowledge-note", "bai/source"], scope: ["global", "document"] },
      harness.db as unknown as IRelationalDb<DB>,
    );
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it("is written from a source's resulting state, without its text, and never becomes a graph node or activity", async () => {
    await processor.onOperations([sourceOperation({ documentId: "s1", status: "EXTRACTING", timestampUtcMs: "2026-10-15T19:05:00.000Z" })]);
    const rows = await createGraphQuery(harness.db).timelineSources();
    expect(rows.get("s1")).toEqual({
      id: "s1",
      addedAt: "2026-10-15T19:04:00.000Z",
      batchAt: "2026-10-15T19:04:00.000Z",
      title: "Chapter 1",
      status: "EXTRACTING",
      addedBy: "0x1234567890abcdef1234567890abcdef12345678",
      sourceType: "BOOK_CHAPTER",
      fileName: "Machine-Learning-Systems-Vol1.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12_197_035,
      method: "converted",
      tool: "docling.rs",
      url: null,
      claimIds: [],
    });
    const raw = await harness.db.selectFrom("graph_sources").select("row_json").executeTakeFirstOrThrow();
    expect(raw.row_json).not.toContain("A very long chapter");
    expect(await harness.db.selectFrom("graph_nodes").selectAll().execute()).toEqual([]);
    expect(await harness.db.selectFrom("graph_operations").selectAll().execute()).toEqual([]);
  });

  it("follows the source's later operations", async () => {
    await processor.onOperations([sourceOperation({ documentId: "s1", status: "EXTRACTING", timestampUtcMs: "2026-10-15T19:05:00.000Z" })]);
    await processor.onOperations([sourceOperation({ documentId: "s1", status: "EXTRACTED", index: 1, timestampUtcMs: "2026-10-15T19:20:00.000Z", claims: ["n1", "n2"] })]);
    const row = (await createGraphQuery(harness.db).timelineSources()).get("s1");
    expect(row).toMatchObject({ status: "EXTRACTED", claimIds: ["n1", "n2"] });
  });

  it("leaves when the source leaves the drive", async () => {
    await processor.onOperations([sourceOperation({ documentId: "s1", status: "EXTRACTED", timestampUtcMs: "2026-10-15T19:05:00.000Z" })]);
    await processor.onOperations([makeOp({ documentId: "drive-1", documentType: "powerhouse/document-drive", actionType: "DELETE_NODE", actionInput: { id: "s1" }, index: 9 })]);
    expect((await createGraphQuery(harness.db).timelineSources()).size).toBe(0);
  });
});

describe("graph_sources: second review", () => {
  let harness: TestDb;
  let processor: InstanceType<typeof GraphIndexerProcessor>;
  beforeEach(async () => {
    harness = await createTestDb();
    processor = new GraphIndexerProcessor(
      "test",
      { branch: ["main"], documentId: ["*"], documentType: ["bai/knowledge-note", "bai/source"], scope: ["global", "document"] },
      harness.db as unknown as IRelationalDb<DB>,
    );
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  it("never lets an older operation replace a newer row", async () => {
    await processor.onOperations([sourceOperation({ documentId: "s1", status: "EXTRACTED", index: 5, timestampUtcMs: "2026-10-15T19:20:00.000Z" })]);
    await processor.onOperations([sourceOperation({ documentId: "s1", status: "EXTRACTING", index: 2, timestampUtcMs: "2026-10-15T19:05:00.000Z" })]);
    expect((await createGraphQuery(harness.db).timelineSources()).get("s1")?.status).toBe("EXTRACTED");
  });

  it("treats a row of an older shape as missing, so it is read again", async () => {
    await harness.db.insertInto("graph_sources").values({ document_id: "s-old", row_json: JSON.stringify({ id: "s-old" }), updated_at: "2026-10-01T00:00:00.000Z", version: 0 }).execute();
    expect((await createGraphQuery(harness.db).timelineSources()).has("s-old")).toBe(false);
  });

  it("keeps relationship actions on a source out of the graph and the activity", async () => {
    const link = makeOp({ documentId: "s1", documentType: "bai/source", actionType: "ADD_RELATIONSHIP", actionInput: { sourceId: "s1", targetId: "n1", relationshipType: "RELATES_TO" }, index: 1 });
    await processor.onOperations([{ ...link, context: { ...link.context, scope: "document" } } as OperationWithContext]);
    expect(await harness.db.selectFrom("graph_edges").selectAll().execute()).toEqual([]);
    expect(await harness.db.selectFrom("graph_operations").selectAll().execute()).toEqual([]);
  });
});

describe("migration: arrival times for rows that predate the column", () => {
  let harness: TestDb;
  beforeEach(async () => {
    harness = await createTestDb();
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  it("are taken from the document's first recorded operation, and left alone where already set", async () => {
    const node = (id: string, added: string | null) => ({ id, document_id: id, title: id, description: null, note_type: "concept", status: "IN_REVIEW", updated_at: "2026-10-16T00:00:00.000Z", document_type: "bai/knowledge-note", added_at: added });
    await harness.db.insertInto("graph_nodes").values([node("old", null), node("set", "2026-10-01T00:00:00.000Z"), node("bare", null), node("epoch", null)]).execute();
    const op = (doc: string, index: number, timestamp: string) => ({ id: `${doc}-${index}`, document_id: doc, operation_type: "SET_TITLE", timestamp, index, scope: "global", summary: null, input_json: null, signer_address: null, signer_app: null, signer_key: null, signature: null });
    await harness.db
      .insertInto("graph_operations")
      .values([op("old", 3, "2026-10-15T14:21:00.000Z"), op("old", 0, "2026-10-15T14:20:00.000Z"), op("set", 0, "2026-10-14T00:00:00.000Z"), op("epoch", 0, "1792145880000")])
      .execute();
    await up(harness.db as unknown as IRelationalDb<DB>);
    const added = Object.fromEntries((await harness.db.selectFrom("graph_nodes").select(["document_id", "added_at"]).execute()).map((r) => [r.document_id, r.added_at]));
    // Only ISO times are trusted: an epoch string would sort before every date.
    expect(added).toEqual({ old: "2026-10-15T14:20:00.000Z", set: "2026-10-01T00:00:00.000Z", bare: null, epoch: null });
  });
});

describe("migration: graph_sources from an earlier build of this branch", () => {
  it("gains revision and version in place, keeping its rows", async () => {
    const { Kysely } = await import("kysely");
    const { PGlite } = await import("@electric-sql/pglite");
    const { PGliteDialect } = await import("kysely-pglite-dialect");
    const pglite = new PGlite();
    const db = new Kysely<DB>({ dialect: new PGliteDialect(pglite) });
    try {
      await db.schema.createTable("graph_sources").addColumn("document_id", "varchar(255)", (c) => c.primaryKey()).addColumn("row_json", "text", (c) => c.notNull()).addColumn("updated_at", "varchar(50)", (c) => c.notNull()).execute();
      await db.insertInto("graph_sources").values({ document_id: "s1", row_json: "{}", updated_at: "2026-10-16T00:00:00.000Z" }).execute();
      await up(db as unknown as IRelationalDb<DB>);
      const row = await db.selectFrom("graph_sources").select(["document_id", "revision", "version"]).executeTakeFirstOrThrow();
      expect(row).toEqual({ document_id: "s1", revision: -1, version: 1 });
    } finally {
      await db.destroy();
    }
  });
});
