import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import type { OperationWithContext } from "@powerhousedao/shared/document-model";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { up, down } from "../../processors/graph-indexer/migrations.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";
import { GraphIndexerProcessor } from "../../processors/graph-indexer/index.js";

const T1 = "2026-09-02T10:00:00.000Z";
const T2 = "2026-09-02T11:00:00.000Z";
const T3 = "2026-09-02T12:00:00.000Z";

function relOp(
  index: number,
  type: "ADD_RELATIONSHIP" | "UPDATE_RELATIONSHIP" | "REMOVE_RELATIONSHIP",
  input: Record<string, unknown>,
  timestampUtcMs = T1,
): OperationWithContext {
  const sourceId = String(input.sourceId);
  return {
    operation: {
      index,
      skip: 0,
      hash: `h${index}`,
      timestampUtcMs,
      id: `${sourceId}-${index}`,
      action: { id: `act-${sourceId}-${index}`, type, scope: "document", timestampUtcMs, input },
    },
    context: {
      documentId: sourceId,
      documentType: "bai/knowledge-note",
      scope: "document",
      branch: "main",
      ordinal: index,
    },
  } as unknown as OperationWithContext;
}

function globalOp(index: number, documentId: string, title: string, timestampUtcMs: string): OperationWithContext {
  return {
    operation: {
      index,
      skip: 0,
      hash: `g${index}`,
      timestampUtcMs,
      id: `${documentId}-g${index}`,
      action: { id: `act-g-${index}`, type: "SET_TITLE", scope: "global", timestampUtcMs, input: { title } },
    },
    context: {
      documentId,
      documentType: "bai/knowledge-note",
      scope: "global",
      branch: "main",
      ordinal: 100 + index,
    },
  } as unknown as OperationWithContext;
}

describe("link changes are activity", () => {
  let db: Kysely<DB>;
  let query: ReturnType<typeof createGraphQuery>;
  let processor: GraphIndexerProcessor;

  beforeAll(async () => {
    const pglite = new PGlite();
    db = new Kysely<DB>({ dialect: new PGliteDialect(pglite) });
    await up(db as unknown as IRelationalDb<DB>);
    query = createGraphQuery(db);
    processor = new GraphIndexerProcessor(
      "link_activity_ns",
      { documentType: [], scope: [], branch: [], documentId: [] },
      db as unknown as IRelationalDb<DB>, undefined,
      { embed: false },
    );
  });

  afterAll(async () => {
    await down(db as unknown as IRelationalDb<DB>);
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom("graph_operations").execute();
    await db.deleteFrom("graph_edges").execute();
    await db.deleteFrom("graph_nodes").execute();
    for (const id of ["a", "b"]) {
      await db
        .insertInto("graph_nodes")
        .values({ id, document_id: id, title: `Note ${id}`, description: null, note_type: null, status: "CANONICAL", updated_at: T1, document_type: "bai/knowledge-note" })
        .execute();
    }
  });

  it("records add, update and remove on the note the link starts from", async () => {
    await processor.onOperations([
      relOp(0, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "BUILDS_ON", metadata: { reason: "r" } }, T1),
      relOp(1, "UPDATE_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "BUILDS_ON", metadata: { reason: "r2" } }, T2),
      relOp(2, "REMOVE_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "BUILDS_ON" }, T3),
    ]);
    const rows = await query.history("a");
    expect(rows.map((r) => [r.id, r.scope, r.operationType, r.summary])).toEqual([
      ["a-document-2", "document", "REMOVE_RELATIONSHIP", "Removed the link to “Note b”"],
      ["a-document-1", "document", "UPDATE_RELATIONSHIP", "Changed why it links to “Note b”"],
      ["a-document-0", "document", "ADD_RELATIONSHIP", "Linked to “Note b” (builds on)"],
    ]);
    expect(JSON.parse(rows[2].inputJson ?? "null")).toMatchObject({ targetId: "b" });
  });

  it("falls back to the target id when the target is not indexed", async () => {
    await processor.onOperations([
      relOp(0, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "ghost", relationshipType: "RELATES_TO" }),
    ]);
    expect((await query.history("a"))[0].summary).toBe("Linked to “ghost” (relates to)");
  });

  it("does not collide with a global-scope operation of the same index", async () => {
    await processor.onOperations([
      globalOp(0, "a", "A title", T1),
      relOp(0, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "RELATES_TO" }, T2),
    ]);
    const ids = (await query.history("a")).map((r) => r.id).sort((x, y) => x.localeCompare(y));
    expect(ids).toEqual(["a-0", "a-document-0"]);
  });

  it("history interleaves the two scopes by time, newest first", async () => {
    await processor.onOperations([
      globalOp(0, "a", "first", T1),
      relOp(0, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "RELATES_TO" }, T2),
      globalOp(1, "a", "third", T3),
    ]);
    // Sorting by index alone would put the link (index 0) last and the
    // title change (index 1) before the first title change (index 0).
    expect((await query.history("a")).map((r) => r.id)).toEqual(["a-1", "a-document-0", "a-0"]);
  });

  it("still applies the edge, and an unrecordable row never blocks it", async () => {
    await processor.onOperations([
      relOp(0, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "RELATES_TO" }),
      relOp(0, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "RELATES_TO" }),
    ]);
    expect((await query.forwardLinks("a")).length).toBe(1);
    expect((await query.history("a")).length).toBe(1);
  });
});
