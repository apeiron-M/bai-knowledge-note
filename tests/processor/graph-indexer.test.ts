import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { up, down } from "../../processors/graph-indexer/migrations.js";

let db: Kysely<DB>;

beforeAll(async () => {
  const pglite = new PGlite();
  db = new Kysely<DB>({ dialect: new PGliteDialect(pglite) });
  await up(db as any);
});

afterAll(async () => {
  await down(db as any);
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
    await db.deleteFrom("graph_nodes").where("document_id", "=", "doc-1").execute();
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
    await db.deleteFrom("graph_nodes").where("document_id", "=", docId).execute();
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
