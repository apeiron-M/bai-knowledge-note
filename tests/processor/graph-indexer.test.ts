import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { up, down } from "../../processors/graph-indexer/migrations.js";
import type { OperationWithContext } from "@powerhousedao/shared/document-model";
import { GraphIndexerProcessor } from "../../processors/graph-indexer/index.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";
import { makeOp } from "../helpers/make-op.js";

let db: Kysely<DB>;

beforeAll(async () => {
  const pglite = new PGlite();
  db = new Kysely<DB>({ dialect: new PGliteDialect(pglite) });
  await up(db as unknown as IRelationalDb<DB>);
});

afterAll(async () => {
  await down(db as unknown as IRelationalDb<DB>);
  await db.destroy();
});

describe("graph_nodes table", () => {
  it("inserts a node and retrieves it with correct fields", async () => {
    await db
      .insertInto("graph_nodes")
      .values({
        id: "node-1",
        document_id: "doc-1",
        title: "Test Node",
        description: "A test node",
        note_type: "regular",
        status: "CANONICAL",
        updated_at: "2024-01-01T00:00:00Z",
      })
      .execute();

    const row = await db
      .selectFrom("graph_nodes")
      .where("document_id", "=", "doc-1")
      .selectAll()
      .executeTakeFirst();

    expect(row).toBeDefined();
    expect(row!.id).toBe("node-1");
    expect(row!.document_id).toBe("doc-1");
    expect(row!.title).toBe("Test Node");
    expect(row!.description).toBe("A test node");
    expect(row!.note_type).toBe("regular");
    expect(row!.status).toBe("CANONICAL");
    expect(row!.updated_at).toBe("2024-01-01T00:00:00Z");

    // cleanup
    await db
      .deleteFrom("graph_nodes")
      .where("document_id", "=", "doc-1")
      .execute();
  });
});

describe("graph_edges table", () => {
  it("inserts an edge and retrieves it with correct fields", async () => {
    // Insert prerequisite nodes
    await db
      .insertInto("graph_nodes")
      .values([
        {
          id: "n-edge-src",
          document_id: "doc-edge-src",
          title: "Source",
          description: null,
          note_type: null,
          status: "CANONICAL",
          updated_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "n-edge-tgt",
          document_id: "doc-edge-tgt",
          title: "Target",
          description: null,
          note_type: null,
          status: "CANONICAL",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ])
      .execute();

    await db
      .insertInto("graph_edges")
      .values({
        id: "edge-1",
        source_document_id: "doc-edge-src",
        target_document_id: "doc-edge-tgt",
        link_type: "references",
        target_title: "Target",
        updated_at: "2024-01-01T00:00:00Z",
      })
      .execute();

    const row = await db
      .selectFrom("graph_edges")
      .where("id", "=", "edge-1")
      .selectAll()
      .executeTakeFirst();

    expect(row).toBeDefined();
    expect(row!.id).toBe("edge-1");
    expect(row!.source_document_id).toBe("doc-edge-src");
    expect(row!.target_document_id).toBe("doc-edge-tgt");
    expect(row!.link_type).toBe("references");
    expect(row!.target_title).toBe("Target");

    // cleanup
    await db.deleteFrom("graph_edges").where("id", "=", "edge-1").execute();
    await db
      .deleteFrom("graph_nodes")
      .where("document_id", "in", ["doc-edge-src", "doc-edge-tgt"])
      .execute();
  });
});

describe("cascade delete", () => {
  it("deletes edges referencing a node then deletes the node, leaving both tables clean", async () => {
    await db
      .insertInto("graph_nodes")
      .values([
        {
          id: "n-cascade-a",
          document_id: "doc-cascade-a",
          title: "A",
          description: null,
          note_type: null,
          status: "CANONICAL",
          updated_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "n-cascade-b",
          document_id: "doc-cascade-b",
          title: "B",
          description: null,
          note_type: null,
          status: "CANONICAL",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ])
      .execute();

    await db
      .insertInto("graph_edges")
      .values([
        {
          id: "e-cascade-1",
          source_document_id: "doc-cascade-a",
          target_document_id: "doc-cascade-b",
          link_type: null,
          target_title: null,
          updated_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "e-cascade-2",
          source_document_id: "doc-cascade-b",
          target_document_id: "doc-cascade-a",
          link_type: null,
          target_title: null,
          updated_at: "2024-01-01T00:00:00Z",
        },
      ])
      .execute();

    // Delete all edges referencing doc-cascade-a (as source or target)
    await db
      .deleteFrom("graph_edges")
      .where((eb) =>
        eb.or([
          eb("source_document_id", "=", "doc-cascade-a"),
          eb("target_document_id", "=", "doc-cascade-a"),
        ]),
      )
      .execute();

    // Delete the node itself
    await db
      .deleteFrom("graph_nodes")
      .where("document_id", "=", "doc-cascade-a")
      .execute();

    // Verify no edges referencing doc-cascade-a remain
    const remainingEdges = await db
      .selectFrom("graph_edges")
      .where((eb) =>
        eb.or([
          eb("source_document_id", "=", "doc-cascade-a"),
          eb("target_document_id", "=", "doc-cascade-a"),
        ]),
      )
      .selectAll()
      .execute();
    expect(remainingEdges).toHaveLength(0);

    // Verify the node is gone
    const remainingNode = await db
      .selectFrom("graph_nodes")
      .where("document_id", "=", "doc-cascade-a")
      .selectAll()
      .executeTakeFirst();
    expect(remainingNode).toBeUndefined();

    // cleanup remaining b node and its (now orphaned) edges
    await db
      .deleteFrom("graph_edges")
      .where("source_document_id", "=", "doc-cascade-b")
      .execute();
    await db
      .deleteFrom("graph_nodes")
      .where("document_id", "=", "doc-cascade-b")
      .execute();
  });
});

describe("upsert on conflict", () => {
  it("inserts the same document_id twice and only keeps 1 row with updated values", async () => {
    const docId = "doc-upsert-1";

    await db
      .insertInto("graph_nodes")
      .values({
        id: "n-upsert-1",
        document_id: docId,
        title: "Original Title",
        description: null,
        note_type: null,
        status: "DRAFT",
        updated_at: "2024-01-01T00:00:00Z",
      })
      .execute();

    // Second insert with same document_id — upsert by updating fields
    await db
      .insertInto("graph_nodes")
      .values({
        id: "n-upsert-1",
        document_id: docId,
        title: "Updated Title",
        description: "Now has a description",
        note_type: null,
        status: "CANONICAL",
        updated_at: "2024-06-01T00:00:00Z",
      })
      .onConflict((oc) =>
        oc.column("document_id").doUpdateSet({
          title: "Updated Title",
          description: "Now has a description",
          status: "CANONICAL",
          updated_at: "2024-06-01T00:00:00Z",
        }),
      )
      .execute();

    const rows = await db
      .selectFrom("graph_nodes")
      .where("document_id", "=", docId)
      .selectAll()
      .execute();

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Updated Title");
    expect(rows[0].description).toBe("Now has a description");
    expect(rows[0].status).toBe("CANONICAL");
    expect(rows[0].updated_at).toBe("2024-06-01T00:00:00Z");

    // cleanup
    await db
      .deleteFrom("graph_nodes")
      .where("document_id", "=", docId)
      .execute();
  });
});

describe("edge reconciliation", () => {
  it("inserts 3 edges for source doc-1, deletes all, re-inserts 2 — exactly 2 edges remain", async () => {
    const sourceDocId = "doc-recon-src";

    await db
      .insertInto("graph_nodes")
      .values([
        {
          id: "n-recon-src",
          document_id: sourceDocId,
          title: "Source",
          description: null,
          note_type: null,
          status: "CANONICAL",
          updated_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "n-recon-t1",
          document_id: "doc-recon-t1",
          title: "Target 1",
          description: null,
          note_type: null,
          status: "CANONICAL",
          updated_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "n-recon-t2",
          document_id: "doc-recon-t2",
          title: "Target 2",
          description: null,
          note_type: null,
          status: "CANONICAL",
          updated_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "n-recon-t3",
          document_id: "doc-recon-t3",
          title: "Target 3",
          description: null,
          note_type: null,
          status: "CANONICAL",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ])
      .execute();

    // Insert 3 edges
    await db
      .insertInto("graph_edges")
      .values([
        {
          id: "e-recon-1",
          source_document_id: sourceDocId,
          target_document_id: "doc-recon-t1",
          link_type: null,
          target_title: null,
          updated_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "e-recon-2",
          source_document_id: sourceDocId,
          target_document_id: "doc-recon-t2",
          link_type: null,
          target_title: null,
          updated_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "e-recon-3",
          source_document_id: sourceDocId,
          target_document_id: "doc-recon-t3",
          link_type: null,
          target_title: null,
          updated_at: "2024-01-01T00:00:00Z",
        },
      ])
      .execute();

    // Delete all edges for the source
    await db
      .deleteFrom("graph_edges")
      .where("source_document_id", "=", sourceDocId)
      .execute();

    // Re-insert only 2 edges
    await db
      .insertInto("graph_edges")
      .values([
        {
          id: "e-recon-1",
          source_document_id: sourceDocId,
          target_document_id: "doc-recon-t1",
          link_type: null,
          target_title: null,
          updated_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "e-recon-2",
          source_document_id: sourceDocId,
          target_document_id: "doc-recon-t2",
          link_type: null,
          target_title: null,
          updated_at: "2024-01-01T00:00:00Z",
        },
      ])
      .execute();

    const remainingEdges = await db
      .selectFrom("graph_edges")
      .where("source_document_id", "=", sourceDocId)
      .selectAll()
      .execute();

    expect(remainingEdges).toHaveLength(2);

    const targetIds = remainingEdges.map((e) => e.target_document_id).sort();
    expect(targetIds).toEqual(["doc-recon-t1", "doc-recon-t2"]);

    // cleanup
    await db
      .deleteFrom("graph_edges")
      .where("source_document_id", "=", sourceDocId)
      .execute();
    await db
      .deleteFrom("graph_nodes")
      .where("document_id", "in", [
        sourceDocId,
        "doc-recon-t1",
        "doc-recon-t2",
        "doc-recon-t3",
      ])
      .execute();
  });
});

// ---- Change history: document_type on every operation row ----

describe("graph_operations.document_type", () => {
  it("is added by the migration and backfilled from graph_nodes for rows that predate it", async () => {
    await db
      .insertInto("graph_nodes")
      .values({
        id: "doc-type-n1",
        document_id: "doc-type-n1",
        title: "N1",
        description: null,
        note_type: null,
        status: "CANONICAL",
        content: null,
        author: null,
        source_origin: null,
        created_at: null,
        added_at: null,
        updated_at: "2026-11-01T00:00:00.000Z",
        document_type: "bai/knowledge-note",
      })
      .execute();
    await db
      .insertInto("graph_operations")
      .values({
        id: "doc-type-n1-0",
        document_id: "doc-type-n1",
        operation_type: "SET_TITLE",
        timestamp: "2026-11-01T00:00:00.000Z",
        index: 0,
        scope: "global",
        summary: null,
        input_json: null,
        signer_address: null,
        signer_app: null,
        signer_key: null,
        signature: null,
        document_type: null,
      })
      .execute();

    await up(db as unknown as IRelationalDb<DB>);

    const row = await db
      .selectFrom("graph_operations")
      .select("document_type")
      .where("id", "=", "doc-type-n1-0")
      .executeTakeFirstOrThrow();
    expect(row.document_type).toBe("bai/knowledge-note");

    await db.deleteFrom("graph_operations").where("document_id", "=", "doc-type-n1").execute();
    await db.deleteFrom("graph_nodes").where("document_id", "=", "doc-type-n1").execute();
  });
});

describe("source operations are recorded", () => {
  const ingest = (o: { documentId: string; index: number; method: string; title: string; timestampUtcMs: string }): OperationWithContext => {
    const entry = makeOp({
      documentId: o.documentId,
      documentType: "bai/source",
      actionType: "INGEST_SOURCE",
      actionInput: {
        title: o.title,
        content: "Body text",
        sourceType: "DOCUMENTATION",
        method: o.method,
        url: "https://github.com/powerhouse-inc/powerhouse",
        createdAt: "2026-11-03T18:00:00.000Z",
      },
      index: o.index,
    });
    const state = {
      header: { id: o.documentId, name: "s", createdAtUtcIso: "2026-11-03T18:00:00.000Z", revision: { global: o.index + 1 } },
      global: { title: o.title, content: "Body text", status: "INGESTED", sourceType: "DOCUMENTATION", extractedClaims: [] },
    };
    return {
      ...entry,
      operation: { ...entry.operation, timestampUtcMs: o.timestampUtcMs },
      context: { ...entry.context, resultingState: JSON.stringify(state) },
    } as OperationWithContext;
  };

  it("writes an INGEST_SOURCE row typed bai/source, with the git ref in its summary, and keeps it out of activity()", async () => {
    const processor = new GraphIndexerProcessor(
      "test",
      { branch: ["main"], documentId: ["*"], documentType: ["bai/knowledge-note", "bai/source"], scope: ["global", "document"] },
      db as unknown as IRelationalDb<DB>,
      undefined,
      { embed: false },
    );
    await processor.onOperations([
      ingest({ documentId: "src-hist-1", index: 3, method: "sha256:abc git:v6.2.3-dev.91+e0f277d", title: "Processors guide", timestampUtcMs: "2026-11-03T19:00:00.000Z" }),
    ]);

    const row = await db
      .selectFrom("graph_operations")
      .selectAll()
      .where("document_id", "=", "src-hist-1")
      .executeTakeFirstOrThrow();
    expect(row.id).toBe("src-hist-1-3");
    expect(row.document_type).toBe("bai/source");
    expect(row.operation_type).toBe("INGEST_SOURCE");
    expect(row.summary).toContain("v6.2.3-dev.91+e0f277d");
    expect(row.summary).toContain("Processors guide");

    const q = createGraphQuery(db);
    expect((await q.activity(100)).map((r) => r.documentId)).not.toContain("src-hist-1");
    expect((await q.activityByType("INGEST_SOURCE", 100))).toEqual([]);

    await db.deleteFrom("graph_operations").where("document_id", "=", "src-hist-1").execute();
    await db.deleteFrom("graph_sources").where("document_id", "=", "src-hist-1").execute();
  });

  it("types a note's operation rows with the note's document type", async () => {
    const processor = new GraphIndexerProcessor(
      "test",
      { branch: ["main"], documentId: ["*"], documentType: ["bai/knowledge-note"], scope: ["global"] },
      db as unknown as IRelationalDb<DB>,
      undefined,
      { embed: false },
    );
    await processor.onOperations([
      makeOp({ documentId: "note-hist-1", actionType: "SET_TITLE", actionInput: { title: "T" }, index: 1, resultingState: { title: "T", topics: [] } }),
    ]);
    const row = await db
      .selectFrom("graph_operations")
      .select("document_type")
      .where("document_id", "=", "note-hist-1")
      .executeTakeFirstOrThrow();
    expect(row.document_type).toBe("bai/knowledge-note");
    await db.deleteFrom("graph_operations").where("document_id", "=", "note-hist-1").execute();
    await db.deleteFrom("graph_topics").where("document_id", "=", "note-hist-1").execute();
    await db.deleteFrom("graph_nodes").where("document_id", "=", "note-hist-1").execute();
  });
});

describe("graph_operations ids by scope", () => {
  it("keeps a document-scope CREATE_DOCUMENT and the global operation of the same index apart", async () => {
    const processor = new GraphIndexerProcessor(
      "test",
      { branch: ["main"], documentId: ["*"], documentType: ["bai/knowledge-note"], scope: ["global", "document"] },
      db as unknown as IRelationalDb<DB>,
      undefined,
      { embed: false },
    );
    const create = makeOp({ documentId: "note-scope-1", actionType: "CREATE_DOCUMENT", actionInput: {}, index: 0 });
    const createDoc = { ...create, context: { ...create.context, scope: "document" } } as OperationWithContext;
    await processor.onOperations([
      createDoc,
      makeOp({ documentId: "note-scope-1", actionType: "SET_TITLE", actionInput: { title: "First" }, index: 0, resultingState: { title: "First", topics: [] } }),
    ]);
    const rows = await db
      .selectFrom("graph_operations")
      .select(["id", "operation_type"])
      .where("document_id", "=", "note-scope-1")
      .orderBy("id")
      .execute();
    expect(rows).toEqual([
      { id: "note-scope-1-0", operation_type: "SET_TITLE" },
      { id: "note-scope-1-document-0", operation_type: "CREATE_DOCUMENT" },
    ]);
    await db.deleteFrom("graph_operations").where("document_id", "=", "note-scope-1").execute();
    await db.deleteFrom("graph_topics").where("document_id", "=", "note-scope-1").execute();
    await db.deleteFrom("graph_nodes").where("document_id", "=", "note-scope-1").execute();
  });
});
