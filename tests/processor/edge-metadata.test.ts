import { describe, it, expect } from "vitest";
import {
  EDGE_CONFIDENCE_LEVELS,
  isEdgeConfidence,
  normalizeEdgeMetadata,
  parseEdgeMetadata,
  serializeEdgeMetadata,
} from "../../processors/graph-indexer/edge-metadata.js";

describe("edge metadata", () => {
  it("knows the three confidence levels", () => {
    expect([...EDGE_CONFIDENCE_LEVELS]).toEqual(["grounded", "established", "speculative"]);
    expect(isEdgeConfidence("grounded")).toBe(true);
    expect(isEdgeConfidence("high")).toBe(false);
    expect(isEdgeConfidence(1)).toBe(false);
  });

  it("keeps a trimmed reason and a valid confidence, drops the rest of the noise", () => {
    expect(
      normalizeEdgeMetadata({ reason: "  B refines A's claim about caching  ", confidence: "established" }),
    ).toEqual({ reason: "B refines A's claim about caching", confidence: "established" });
    expect(normalizeEdgeMetadata({ reason: "   " })).toBeNull();
    expect(normalizeEdgeMetadata({ confidence: "very" })).toBeNull();
    expect(normalizeEdgeMetadata({ reason: 42 })).toBeNull();
  });

  it("preserves foreign keys other apps may attach", () => {
    expect(normalizeEdgeMetadata({ weight: 0.4, reason: "x" })).toEqual({ weight: 0.4, reason: "x" });
    expect(normalizeEdgeMetadata({ weight: undefined })).toBeNull();
  });

  it("ignores non-objects", () => {
    expect(normalizeEdgeMetadata(null)).toBeNull();
    expect(normalizeEdgeMetadata("because")).toBeNull();
    expect(normalizeEdgeMetadata(["because"])).toBeNull();
    expect(normalizeEdgeMetadata(undefined)).toBeNull();
  });

  it("round-trips through the text column and survives junk", () => {
    const m = { reason: "why", confidence: "speculative" as const };
    expect(parseEdgeMetadata(serializeEdgeMetadata(m))).toEqual(m);
    expect(serializeEdgeMetadata(null)).toBeNull();
    expect(parseEdgeMetadata(null)).toBeNull();
    expect(parseEdgeMetadata("not json")).toBeNull();
    expect(parseEdgeMetadata('{"confidence":"bogus"}')).toBeNull();
  });
});

// ── Processor + query behaviour ────────────────────────────────────────

import { beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import type { OperationWithContext } from "@powerhousedao/shared/document-model";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { up, down } from "../../processors/graph-indexer/migrations.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";
import { GraphIndexerProcessor } from "../../processors/graph-indexer/index.js";
import {
  documentIndexerOf,
  edgeIdOf,
  readRelationshipMetadata,
  type RelationshipMetadataPage,
} from "../../subgraphs/knowledge-graph/helpers/edge-metadata-reader.js";

const T = "2026-09-02T10:00:00.000Z";

function relOp(
  index: number,
  type: "ADD_RELATIONSHIP" | "UPDATE_RELATIONSHIP" | "REMOVE_RELATIONSHIP",
  input: Record<string, unknown>,
  timestampUtcMs = T,
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

describe("edges carry their articulation", () => {
  let db: Kysely<DB>;
  let query: ReturnType<typeof createGraphQuery>;
  let processor: GraphIndexerProcessor;

  beforeAll(async () => {
    const pglite = new PGlite();
    db = new Kysely<DB>({ dialect: new PGliteDialect(pglite) });
    await up(db as unknown as IRelationalDb<DB>);
    query = createGraphQuery(db);
    processor = new GraphIndexerProcessor(
      "edge_meta_ns",
      { documentType: [], scope: [], branch: [], documentId: [] },
      db as unknown as IRelationalDb<DB>,
      { embed: false },
    );
  });

  afterAll(async () => {
    await down(db as unknown as IRelationalDb<DB>);
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom("graph_edges").execute();
    await db.deleteFrom("graph_nodes").execute();
    for (const id of ["a", "b", "c"]) {
      await db
        .insertInto("graph_nodes")
        .values({ id, document_id: id, title: `Note ${id}`, description: null, note_type: null, status: "CANONICAL", updated_at: T, document_type: "bai/knowledge-note" })
        .execute();
    }
  });

  it("stores reason and confidence from ADD_RELATIONSHIP and exposes them on every edge read", async () => {
    await processor.onOperations([
      relOp(0, "ADD_RELATIONSHIP", {
        sourceId: "a", targetId: "b", relationshipType: "BUILDS_ON",
        metadata: { reason: "b generalises a's caching claim to all read models", confidence: "established" },
      }),
      relOp(1, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "c", relationshipType: "RELATES_TO" }),
    ]);
    const fwd = await query.forwardLinks("a");
    const ab = fwd.find((e) => e.targetDocumentId === "b");
    const ac = fwd.find((e) => e.targetDocumentId === "c");
    expect(ab).toMatchObject({
      reason: "b generalises a's caching claim to all read models",
      confidence: "established",
    });
    expect(JSON.parse(ab!.metadataJson ?? "null")).toEqual({
      reason: "b generalises a's caching claim to all read models",
      confidence: "established",
    });
    expect(ac).toMatchObject({ reason: null, confidence: null, metadataJson: null });
    expect((await query.backlinks("b"))[0]).toMatchObject({ confidence: "established" });
    const reasons = (await query.allEdges()).map((e) => e.reason ?? "");
    expect(reasons.sort((x, y) => x.localeCompare(y))).toEqual([
      "",
      "b generalises a's caching claim to all read models",
    ]);
  });

  it("a repeated ADD never overwrites an existing reason; UPDATE_RELATIONSHIP does", async () => {
    await processor.onOperations([
      relOp(0, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "RELATES_TO", metadata: { reason: "first" } }),
      relOp(1, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "RELATES_TO", metadata: { reason: "second" } }),
    ]);
    expect((await query.forwardLinks("a"))[0].reason).toBe("first");

    // A pre-metadata row (null) takes what a replayed ADD offers.
    await db.updateTable("graph_edges").set({ metadata: null }).execute();
    await processor.onOperations([
      relOp(2, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "RELATES_TO", metadata: { reason: "replayed" } }),
    ]);
    expect((await query.forwardLinks("a"))[0].reason).toBe("replayed");

    await processor.onOperations([
      relOp(3, "UPDATE_RELATIONSHIP", {
        sourceId: "a", targetId: "b", relationshipType: "RELATES_TO",
        metadata: { reason: "articulated later", confidence: "grounded" },
      }, "2026-09-02T12:00:00.000Z"),
    ]);
    const [edge] = await query.forwardLinks("a");
    expect(edge).toMatchObject({ reason: "articulated later", confidence: "grounded", updatedAt: "2026-09-02T12:00:00.000Z" });

    // Updating a containment or unknown type touches nothing.
    await processor.onOperations([
      relOp(4, "UPDATE_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "child", metadata: { reason: "x" } }),
    ]);
    expect((await query.forwardLinks("a"))[0].reason).toBe("articulated later");
  });

  it("counts articulated knowledge edges in stats", async () => {
    await processor.onOperations([
      relOp(0, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "RELATES_TO", metadata: { reason: "why" } }),
      relOp(1, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "c", relationshipType: "RELATES_TO", metadata: { confidence: "grounded" } }),
      relOp(2, "ADD_RELATIONSHIP", { sourceId: "b", targetId: "c", relationshipType: "RELATES_TO" }),
    ]);
    const stats = await query.stats();
    expect(stats.edgeCount).toBe(3);
    expect(stats.articulatedEdgeCount).toBe(1);
  });
});

describe("edge-metadata reader (reindex)", () => {
  it("finds the document indexer only on an in-process client", () => {
    expect(documentIndexerOf(undefined)).toBeNull();
    expect(documentIndexerOf({})).toBeNull();
    expect(documentIndexerOf({ documentIndexer: { getOutgoing: () => {} } })).toBeNull();
    const indexer = { getOutgoing: vi.fn(), getIncoming: vi.fn() };
    expect(documentIndexerOf({ documentIndexer: indexer })).toBe(indexer);
  });

  it("derives the processor's edge id from a relationship row", () => {
    expect(edgeIdOf({ sourceId: "s", targetId: "t", relationshipType: "BUILDS_ON" })).toBe("s-t-BUILDS_ON");
  });

  it("walks every page and keeps only rows with usable metadata", async () => {
    const page2: RelationshipMetadataPage = {
      results: [
        { sourceId: "s", targetId: "t3", relationshipType: "RELATES_TO", metadata: { reason: "  third  " } },
        { sourceId: "s", targetId: "t4", relationshipType: "RELATES_TO", metadata: { confidence: "nope" } },
      ],
    };
    const page1: RelationshipMetadataPage = {
      results: [
        { sourceId: "s", targetId: "t1", relationshipType: "RELATES_TO", metadata: { reason: "first", confidence: "grounded" } },
        { sourceId: "s", targetId: "t2", relationshipType: "RELATES_TO" },
      ],
      next: () => Promise.resolve(page2),
    };
    const fetchPage = vi.fn(() => Promise.resolve(page1));
    const out = await readRelationshipMetadata(fetchPage);
    expect(fetchPage).toHaveBeenCalledWith({ cursor: "0", limit: 100 });
    expect([...out.entries()]).toEqual([
      ["s-t1-RELATES_TO", JSON.stringify({ reason: "first", confidence: "grounded" })],
      ["s-t3-RELATES_TO", JSON.stringify({ reason: "third" })],
    ]);
  });

  it("stops at the page bound instead of following an endless next()", async () => {
    const endless: RelationshipMetadataPage = {
      results: [{ sourceId: "s", targetId: "t", relationshipType: "RELATES_TO", metadata: { reason: "r" } }],
      next: () => Promise.resolve(endless),
    };
    const out = await readRelationshipMetadata(() => Promise.resolve(endless), { maxPages: 3 });
    expect(out.size).toBe(1);
  });
});
