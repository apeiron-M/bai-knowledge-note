/**
 * Two knowledge vaults on one server keep separate indexes.
 *
 * The processor manager has no drive dimension: every instance receives every
 * drive's operations, so isolation is a property of the DriveMembership gate
 * rather than of the ProcessorFilter. The single-processor test proves the
 * gate rejects a foreign document; this proves the thing an operator actually
 * cares about — that adding a SECOND vault leaves the first one's index,
 * counts and search exactly as they were.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import type { OperationWithContext } from "@powerhousedao/shared/document-model";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { up, down } from "../../processors/graph-indexer/migrations.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";
import { GraphIndexerProcessor } from "../../processors/graph-indexer/index.js";

const T = "2026-09-16T10:00:00.000Z";
const DRIVE_A = "drive-alpha";
const DRIVE_B = "drive-beta";

const driveDoc = (id: string, nodeIds: string[]) => ({
  header: { id, meta: { preferredEditor: "knowledge-vault" } },
  state: {
    global: {
      nodes: nodeIds.map((n) => ({ id: n, kind: "file", documentType: "bai/knowledge-note" })),
    },
  },
});

const noteState = (title: string) => ({
  title,
  description: "d",
  noteType: "concept",
  status: "DRAFT",
  topics: [],
});

function op(
  documentId: string,
  index: number,
  type: string,
  input: Record<string, unknown>,
  resultingGlobal?: Record<string, unknown>,
): OperationWithContext {
  return {
    operation: {
      index,
      skip: 0,
      hash: `h${index}`,
      timestampUtcMs: T,
      id: `${documentId}-${index}`,
      action: { id: `act-${documentId}-${index}`, type, scope: "global", timestampUtcMs: T, input },
    },
    context: {
      documentId,
      documentType: "bai/knowledge-note",
      scope: "global",
      branch: "main",
      ordinal: index,
      resultingState: resultingGlobal ? JSON.stringify({ global: resultingGlobal }) : undefined,
    },
  } as unknown as OperationWithContext;
}

let db: Kysely<DB>;
// Each vault gets its OWN namespace in the real host; here one schema stands
// in for both, which is the STRICTER test: if the gate leaked, the rows would
// collide visibly instead of hiding in a separate namespace.
let query: ReturnType<typeof createGraphQuery>;
let alpha: GraphIndexerProcessor;
let beta: GraphIndexerProcessor;

beforeAll(async () => {
  db = new Kysely<DB>({ dialect: new PGliteDialect(new PGlite()) });
  await up(db as unknown as IRelationalDb<DB>);
  query = createGraphQuery(db);
  alpha = new GraphIndexerProcessor(
    "alpha_ns",
    { documentType: [], scope: [], branch: [], documentId: [] },
    db as unknown as IRelationalDb<DB>,
    {
      embed: false,
      membership: {
        driveId: DRIVE_A,
        client: { get: vi.fn(() => Promise.resolve(driveDoc(DRIVE_A, ["a-1", "a-2"]))) },
      },
    },
  );
  beta = new GraphIndexerProcessor(
    "beta_ns",
    { documentType: [], scope: [], branch: [], documentId: [] },
    db as unknown as IRelationalDb<DB>,
    {
      embed: false,
      membership: {
        driveId: DRIVE_B,
        client: { get: vi.fn(() => Promise.resolve(driveDoc(DRIVE_B, ["b-1"]))) },
      },
    },
  );
}, 120000);

afterAll(async () => {
  await down(db as unknown as IRelationalDb<DB>);
  await db.destroy();
});

beforeEach(async () => {
  await db.deleteFrom("graph_operations").execute();
  await db.deleteFrom("graph_topics").execute();
  await db.deleteFrom("graph_edges").execute();
  await db.deleteFrom("graph_nodes").execute();
});

describe("a second vault does not pollute the first", () => {
  it("each processor indexes only its own drive's documents from a shared batch", async () => {
    // The batch every instance receives: both vaults' operations, interleaved
    // exactly as the manager delivers them.
    const batch = [
      op("a-1", 0, "SET_TITLE", { title: "Alpha one" }, noteState("Alpha one")),
      op("b-1", 0, "SET_TITLE", { title: "Beta one" }, noteState("Beta one")),
      op("a-2", 0, "SET_TITLE", { title: "Alpha two" }, noteState("Alpha two")),
    ];
    await alpha.onOperations(batch);
    expect((await query.allNodes()).map((n) => n.documentId).sort()).toEqual(["a-1", "a-2"]);

    await db.deleteFrom("graph_operations").execute();
    await db.deleteFrom("graph_nodes").execute();

    await beta.onOperations(batch);
    expect((await query.allNodes()).map((n) => n.documentId)).toEqual(["b-1"]);
  });

  it("populating the second vault leaves the first one's counts untouched", async () => {
    // What an operator would actually do: build vault A, then create B and
    // fill it. A's stats must not move.
    await alpha.onOperations([
      op("a-1", 0, "SET_TITLE", { title: "Alpha one" }, noteState("Alpha one")),
      op("a-2", 0, "SET_TITLE", { title: "Alpha two" }, noteState("Alpha two")),
    ]);
    const before = await query.stats();
    expect(before.noteCount).toBe(2);

    // B fills up — many documents, arriving through the SAME processor feed.
    await alpha.onOperations(
      Array.from({ length: 25 }, (_, i) =>
        op(`b-bulk-${i}`, 0, "SET_TITLE", { title: `Beta ${i}` }, noteState(`Beta ${i}`)),
      ),
    );

    const after = await query.stats();
    expect(after.noteCount).toBe(before.noteCount);
    expect(after.nodeCount).toBe(before.nodeCount);
    expect((await query.allNodes()).map((n) => n.documentId).sort()).toEqual(["a-1", "a-2"]);
  });

  it("a foreign document never reaches search, topics or the operation log", async () => {
    await alpha.onOperations([
      op("a-1", 0, "SET_TITLE", { title: "Reactor storage" }, {
        ...noteState("Reactor storage"),
        topics: [{ id: "t1", name: "reactor" }],
      }),
      op("b-1", 0, "SET_TITLE", { title: "Reactor storage" }, {
        ...noteState("Reactor storage"),
        topics: [{ id: "t2", name: "reactor" }],
      }),
    ]);
    // Same title in both vaults: a leak would show as two hits.
    expect((await query.searchNodes("Reactor")).map((n) => n.documentId)).toEqual(["a-1"]);
    expect((await query.nodesByTopic("reactor")).map((n) => n.documentId)).toEqual(["a-1"]);
    const ops = await db.selectFrom("graph_operations").select("document_id").execute();
    expect(ops.map((o) => o.document_id)).toEqual(["a-1"]);
  });
});
