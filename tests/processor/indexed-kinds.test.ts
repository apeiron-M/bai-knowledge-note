/**
 * Tensions, observations and research claims are indexed alongside notes and
 * MoCs — as searchable nodes, with derived edges to what they are about —
 * without being counted as knowledge.
 *
 * The contract these tests pin:
 *
 *   - `projectNode` maps every indexed kind to one row shape, and the two
 *     write paths (live processor, reindex) share it.
 *   - Derived edges (`INVOLVES`, `PROMOTED_TO`) are reconciled from state and
 *     show up in backlinks / forward links / the edge list, but NOT in
 *     `edgeCount`, `density` or the orphan predicate.
 *   - Tensions and observations are never orphans; notes, MoCs and research
 *     claims still are when nothing links to them.
 *   - `stats()` reports per-kind counts, and `nodeCount` stays the total.
 *   - The migration backfills `document_type` on rows that predate it.
 *   - The processor stores the signer's did:key and signature tuple per op.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import type { OperationWithContext } from "@powerhousedao/shared/document-model";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { up, down } from "../../processors/graph-indexer/migrations.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";
import {
  GraphIndexerProcessor,
} from "../../processors/graph-indexer/index.js";
import {
  INDEXED_DOCUMENT_TYPES,
  KNOWLEDGE_NODE_TYPES,
  isIndexedDocumentType,
  isKnowledgeNodeType,
  projectNode,
} from "../../processors/graph-indexer/project.js";
import {
  DERIVED_LINK_TYPES,
  INDEXED_LINK_TYPES,
  KNOWLEDGE_LINK_TYPES,
  isIndexedLinkType,
  isKnowledgeLinkType,
} from "../../processors/graph-indexer/link-types.js";
import { pruneNonKnowledgeEdges } from "../../subgraphs/knowledge-graph/helpers/reindex.js";

let db: Kysely<DB>;
let query: ReturnType<typeof createGraphQuery>;

beforeAll(async () => {
  const pglite = new PGlite();
  db = new Kysely<DB>({ dialect: new PGliteDialect(pglite) });
  await up(db as unknown as IRelationalDb<DB>);
  query = createGraphQuery(db);
});

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

const T = "2026-09-02T10:00:00.000Z";

async function node(
  id: string,
  document_type: string | null,
  extra: Partial<DB["graph_nodes"]> = {},
) {
  await db
    .insertInto("graph_nodes")
    .values({
      id,
      document_id: id,
      title: `Title ${id}`,
      description: null,
      note_type: null,
      status: document_type === "bai/moc" ? "MOC" : "CANONICAL",
      updated_at: T,
      document_type,
      ...extra,
    })
    .execute();
}

async function edge(source: string, target: string, link_type: string) {
  await db
    .insertInto("graph_edges")
    .values({
      id: `${source}-${target}-${link_type}`,
      source_document_id: source,
      target_document_id: target,
      link_type,
      target_title: null,
      updated_at: T,
    })
    .execute();
}

describe("link-type sets", () => {
  it("derived types are indexed but not knowledge", () => {
    for (const t of DERIVED_LINK_TYPES) {
      expect(isIndexedLinkType(t)).toBe(true);
      expect(isKnowledgeLinkType(t)).toBe(false);
    }
    for (const t of KNOWLEDGE_LINK_TYPES) {
      expect(isIndexedLinkType(t)).toBe(true);
      expect(isKnowledgeLinkType(t)).toBe(true);
    }
    expect(INDEXED_LINK_TYPES.length).toBe(
      KNOWLEDGE_LINK_TYPES.length + DERIVED_LINK_TYPES.length,
    );
    expect(isIndexedLinkType("child")).toBe(false);
    expect(isIndexedLinkType(null)).toBe(false);
  });
});

describe("document kinds", () => {
  it("five kinds are indexed; three are knowledge", () => {
    expect([...INDEXED_DOCUMENT_TYPES]).toEqual([
      "bai/knowledge-note",
      "bai/moc",
      "bai/research-claim",
      "bai/tension",
      "bai/observation",
    ]);
    expect([...KNOWLEDGE_NODE_TYPES]).toEqual([
      "bai/knowledge-note",
      "bai/moc",
      "bai/research-claim",
    ]);
    expect(isIndexedDocumentType("bai/source")).toBe(false);
    expect(isIndexedDocumentType("powerhouse/document-drive")).toBe(false);
    expect(isKnowledgeNodeType("bai/tension")).toBe(false);
    expect(isKnowledgeNodeType("bai/observation")).toBe(false);
    expect(isKnowledgeNodeType(null)).toBe(false);
  });
});

describe("projectNode()", () => {
  it("knowledge note: provenance, topics, DRAFT default", () => {
    const p = projectNode("bai/knowledge-note", {
      title: "A claim",
      description: "d",
      noteType: "concept",
      content: "body",
      topics: [{ id: "t1", name: "reactor" }, "plain"],
      provenance: { author: "agent", sourceOrigin: "DERIVED", createdAt: T },
    });
    expect(p).toMatchObject({
      title: "A claim",
      note_type: "concept",
      status: "DRAFT",
      author: "agent",
      source_origin: "DERIVED",
      created_at: T,
      document_type: "bai/knowledge-note",
      topics: ["reactor", "plain"],
      derivedEdges: [],
    });
  });

  it("moc: MOC sentinel status, tier in note_type, orientation as content", () => {
    const p = projectNode("bai/moc", {
      title: "Hub",
      tier: "HUB",
      orientation: "Start here",
      createdAt: T,
    });
    expect(p).toMatchObject({
      note_type: "MOC (HUB)",
      status: "MOC",
      content: "Start here",
      created_at: T,
      document_type: "bai/moc",
    });
  });

  it("tension: INVOLVES edge per involved ref, own lifecycle status", () => {
    const p = projectNode("bai/tension", {
      title: "A vs B",
      description: "they disagree",
      involvedRefs: ["a", "b"],
      status: "OPEN",
      observedAt: T,
      observedBy: "graph-indexer",
    });
    expect(p).toMatchObject({
      note_type: "Tension (OPEN)",
      status: "OPEN",
      author: "graph-indexer",
      created_at: T,
      document_type: "bai/tension",
      topics: [],
    });
    expect(p.derivedEdges).toEqual([
      { linkType: "INVOLVES", targetId: "a" },
      { linkType: "INVOLVES", targetId: "b" },
    ]);
  });

  it("tension defaults to OPEN when status is unset (fresh document)", () => {
    const p = projectNode("bai/tension", { involvedRefs: [] });
    expect(p.status).toBe("OPEN");
    expect(p.note_type).toBe("Tension (OPEN)");
    expect(p.derivedEdges).toEqual([]);
  });

  it("observation: PROMOTED_TO edge only once promoted", () => {
    const pending = projectNode("bai/observation", {
      title: "It hurt",
      category: "FRICTION",
      status: "PENDING",
    });
    expect(pending.note_type).toBe("Observation (FRICTION)");
    expect(pending.derivedEdges).toEqual([]);

    const promoted = projectNode("bai/observation", {
      title: "It hurt",
      category: "FRICTION",
      status: "PROMOTED",
      promotedTo: "note-9",
    });
    expect(promoted.status).toBe("PROMOTED");
    expect(promoted.derivedEdges).toEqual([
      { linkType: "PROMOTED_TO", targetId: "note-9" },
    ]);
  });

  it("research claim: kind in note_type, CANONICAL, IMPORT origin, topics", () => {
    const p = projectNode("bai/research-claim", {
      title: "Claim",
      kind: "research",
      topics: ["linking"],
    });
    expect(p).toMatchObject({
      note_type: "Claim (research)",
      status: "CANONICAL",
      source_origin: "IMPORT",
      document_type: "bai/research-claim",
      topics: ["linking"],
    });
  });

  it("empty strings project to null, not ''", () => {
    const p = projectNode("bai/knowledge-note", { title: "", content: "" });
    expect(p.title).toBeNull();
    expect(p.content).toBeNull();
  });
});

describe("migration backfill", () => {
  it("fills document_type on legacy rows from the MOC sentinel", async () => {
    await node("legacy-note", null, { status: "CANONICAL" });
    await node("legacy-moc", null, { status: "MOC" });
    // `up` is idempotent; running it again is what a restart does.
    await up(db as unknown as IRelationalDb<DB>);
    const rows = await db
      .selectFrom("graph_nodes")
      .select(["document_id", "document_type"])
      .orderBy("document_id")
      .execute();
    expect(rows).toEqual([
      { document_id: "legacy-moc", document_type: "bai/moc" },
      { document_id: "legacy-note", document_type: "bai/knowledge-note" },
    ]);
  });
});

describe("query semantics with meta-documents present", () => {
  beforeEach(async () => {
    await node("a", "bai/knowledge-note");
    await node("b", "bai/knowledge-note");
    await node("lonely", "bai/knowledge-note");
    await node("moc", "bai/moc");
    await node("claim", "bai/research-claim");
    await node("tension", "bai/tension", { status: "OPEN" });
    await node("tension-2", "bai/tension", { status: "RESOLVED" });
    await node("obs", "bai/observation", { status: "PROMOTED" });
    await edge("a", "b", "CONTRADICTS");
    await edge("moc", "a", "CORE_IDEA");
    await edge("tension", "a", "INVOLVES");
    await edge("tension", "b", "INVOLVES");
    await edge("obs", "b", "PROMOTED_TO");
  });

  it("stats: per-kind counts, nodeCount is the total, edges exclude derived", async () => {
    const s = await query.stats();
    expect(s.nodeCount).toBe(8);
    expect(s.noteCount).toBe(3);
    expect(s.mocCount).toBe(1);
    expect(s.claimCount).toBe(1);
    expect(s.tensionCount).toBe(2);
    expect(s.openTensionCount).toBe(1);
    expect(s.observationCount).toBe(1);
    // CONTRADICTS + CORE_IDEA only
    expect(s.edgeCount).toBe(2);
  });

  it("orphans: knowledge nodes only — tension/observation never count", async () => {
    const orphans = (await query.orphanNodes()).map((n) => n.documentId).sort();
    // `a` has CORE_IDEA in, `b` has CONTRADICTS in (INVOLVES/PROMOTED_TO don't
    // count, but b is still covered by a→b). lonely, moc, claim have nothing.
    expect(orphans).toEqual(["claim", "lonely", "moc"]);
    expect((await query.stats()).orphanCount).toBe(3);
  });

  it("a derived edge does not rescue a note from orphan status", async () => {
    await db.deleteFrom("graph_edges").where("id", "=", "a-b-CONTRADICTS").execute();
    const orphans = (await query.orphanNodes()).map((n) => n.documentId);
    expect(orphans).toContain("b"); // only INVOLVES / PROMOTED_TO point at b now
  });

  it("density: knowledge edges over knowledge nodes", async () => {
    // 2 knowledge edges, 5 knowledge nodes (a, b, lonely, moc, claim)
    expect(await query.density()).toBeCloseTo(2 / (5 * 4), 10);
  });

  it("backlinks / forwardLinks / allEdges include derived edges", async () => {
    const back = (await query.backlinks("a")).map((e) => e.linkType ?? "").sort((x, y) => x.localeCompare(y));
    expect(back).toEqual(["CORE_IDEA", "INVOLVES"]);
    const fwd = (await query.forwardLinks("tension")).map((e) => e.targetDocumentId).sort();
    expect(fwd).toEqual(["a", "b"]);
    expect((await query.allEdges()).length).toBe(5);
  });

  it("knowledgeDegree counts knowledge edges only", async () => {
    expect(await query.knowledgeDegree("a", "in")).toBe(1); // CORE_IDEA
    expect(await query.knowledgeDegree("a", "out")).toBe(1); // CONTRADICTS
    expect(await query.knowledgeDegree("tension", "out")).toBe(0);
    expect(await query.knowledgeDegree("lonely", "in")).toBe(0);
  });

  it("connections traverse derived edges (a tension is a neighbour)", async () => {
    const around = (await query.connections("tension", 1)).map(
      (c) => `${c.viaLinkType}:${c.node.documentId}`,
    );
    expect(around.sort((a, b) => a.localeCompare(b))).toEqual(["INVOLVES:a", "INVOLVES:b"]);
  });

  it("nodesByDocumentType and documentType on results", async () => {
    const tensions = await query.nodesByDocumentType("bai/tension");
    expect(tensions.map((n) => n.documentId).sort()).toEqual(["tension", "tension-2"]);
    expect(tensions[0].documentType).toBe("bai/tension");
    const a = await query.nodeByDocumentId("a");
    expect(a?.documentType).toBe("bai/knowledge-note");
  });

  it("prune keeps derived edges, drops containment and untyped rows", async () => {
    await edge("drive", "a", "child");
    await db
      .insertInto("graph_edges")
      .values({
        id: "x-y-null",
        source_document_id: "x",
        target_document_id: "y",
        link_type: null,
        target_title: null,
        updated_at: T,
      })
      .execute();
    const removed = await pruneNonKnowledgeEdges(db);
    expect(removed).toBe(2);
    const left = (await db.selectFrom("graph_edges").select("link_type").execute())
      .map((r) => r.link_type ?? "")
      .sort((x, y) => x.localeCompare(y));
    expect(left).toEqual(["CONTRADICTS", "CORE_IDEA", "INVOLVES", "INVOLVES", "PROMOTED_TO"]);
  });
});

/* ------------------------------------------------------------------ */
/*  Driving the processor                                              */
/* ------------------------------------------------------------------ */

const SIGNATURE_TUPLE = [
  "1788349213",
  "did:key:zDnaecHHFa2PUmZGCBLKJZdmL4rM31V8jcLSK7JfWBdysA6dD",
  "o9HEe8PcNLKWgfSgk9Hx8Hk3bfJre0fy/UnQ/n3V7lI=",
  "",
  "0xa3bdd135",
];

function op(
  documentId: string,
  documentType: string,
  index: number,
  type: string,
  input: Record<string, unknown>,
  resultingGlobal: Record<string, unknown> | undefined,
  scope: "global" | "document" = "global",
): OperationWithContext {
  return {
    operation: {
      index,
      skip: 0,
      hash: `h${index}`,
      timestampUtcMs: T,
      id: `${documentId}-${index}`,
      action: {
        id: `act-${documentId}-${index}`,
        type,
        scope,
        timestampUtcMs: T,
        input,
        context: {
          signer: {
            user: { address: "0xadbA7C2F82139031D7564D18aC22D09B12A0BcA4", networkId: "eip155", chainId: 1 },
            app: { name: "switchboard", key: SIGNATURE_TUPLE[1] },
            signatures: [SIGNATURE_TUPLE],
          },
        },
      },
    },
    context: {
      documentId,
      documentType,
      scope,
      branch: "main",
      ordinal: index,
      resultingState: resultingGlobal
        ? JSON.stringify({ global: resultingGlobal })
        : undefined,
    },
  } as unknown as OperationWithContext;
}

describe("GraphIndexerProcessor.onOperations()", () => {
  let processor: GraphIndexerProcessor;

  beforeAll(() => {
    processor = new GraphIndexerProcessor(
      "test_ns",
      { documentType: [], scope: [], branch: [], documentId: [] },
      db as unknown as IRelationalDb<DB>,
      { embed: false },
    );
  });

  it("indexes a tension as a node with INVOLVES edges, then reconciles them", async () => {
    await node("n1", "bai/knowledge-note", { title: "Note one" });
    await node("n2", "bai/knowledge-note", { title: "Note two" });

    await processor.onOperations([
      op("t1", "bai/tension", 0, "CREATE_TENSION",
        { title: "n1 vs n2", description: "d", involvedRefs: ["n1", "n2"], observedAt: T },
        { title: "n1 vs n2", description: "d", involvedRefs: ["n1", "n2"], status: "OPEN", observedAt: T }),
    ]);

    const row = await query.nodeByDocumentId("t1");
    expect(row).toMatchObject({
      documentType: "bai/tension",
      status: "OPEN",
      noteType: "Tension (OPEN)",
      title: "n1 vs n2",
    });
    const fwd = await query.forwardLinks("t1");
    const byTarget = (a: unknown[], b: unknown[]) => String(a[0]).localeCompare(String(b[0]));
    expect(fwd.map((e) => [e.targetDocumentId, e.linkType, e.targetTitle]).sort(byTarget)).toEqual([
      ["n1", "INVOLVES", "Note one"],
      ["n2", "INVOLVES", "Note two"],
    ]);

    // A third note joins; the edge set follows the state exactly.
    await node("n3", "bai/knowledge-note", { title: "Note three" });
    await processor.onOperations([
      op("t1", "bai/tension", 1, "ADD_INVOLVED_REF", { ref: "n3" },
        { title: "n1 vs n2", involvedRefs: ["n1", "n2", "n3"], status: "OPEN" }),
    ]);
    expect((await query.forwardLinks("t1")).map((e) => e.targetDocumentId).sort()).toEqual(["n1", "n2", "n3"]);

    // Resolution changes status and note_type but keeps the edges.
    await processor.onOperations([
      op("t1", "bai/tension", 2, "RESOLVE_TENSION", { resolution: "n1 wins", resolvedAt: T },
        { title: "n1 vs n2", involvedRefs: ["n1", "n2", "n3"], status: "RESOLVED", resolution: "n1 wins" }),
    ]);
    const resolved = await query.nodeByDocumentId("t1");
    expect(resolved?.status).toBe("RESOLVED");
    expect(resolved?.noteType).toBe("Tension (RESOLVED)");
    expect((await query.forwardLinks("t1")).length).toBe(3);

    // None of that made n1..n3 look connected in the knowledge sense.
    expect((await query.stats()).edgeCount).toBe(0);
    expect((await query.orphanNodes()).map((n) => n.documentId).sort()).toEqual(["n1", "n2", "n3"]);
  });

  it("records signer key and the last signature tuple on each operation", async () => {
    await processor.onOperations([
      op("o1", "bai/observation", 0, "CREATE_OBSERVATION",
        { title: "Friction", category: "FRICTION", observedAt: T },
        { title: "Friction", category: "FRICTION", status: "PENDING", observedAt: T }),
    ]);
    const ops = await query.history("o1");
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      operationType: "CREATE_OBSERVATION",
      summary: 'Observation recorded (FRICTION): "Friction"',
      signerAddress: "0xadbA7C2F82139031D7564D18aC22D09B12A0BcA4",
      signerApp: "switchboard",
      signerKey: SIGNATURE_TUPLE[1],
      signature: SIGNATURE_TUPLE.join(", "),
    });
    expect(JSON.parse(ops[0].inputJson ?? "null")).toEqual({
      title: "Friction",
      category: "FRICTION",
      observedAt: T,
    });
  });

  it("observation promotion adds a PROMOTED_TO edge", async () => {
    await node("n9", "bai/knowledge-note");
    await processor.onOperations([
      op("o2", "bai/observation", 0, "CREATE_OBSERVATION", { title: "x", category: "QUALITY", observedAt: T },
        { title: "x", category: "QUALITY", status: "PENDING" }),
      op("o2", "bai/observation", 1, "PROMOTE_OBSERVATION", { promotedTo: "n9", promotedAt: T },
        { title: "x", category: "QUALITY", status: "PROMOTED", promotedTo: "n9" }),
    ]);
    const fwd = await query.forwardLinks("o2");
    expect(fwd.map((e) => [e.targetDocumentId, e.linkType])).toEqual([["n9", "PROMOTED_TO"]]);
    expect((await query.nodeByDocumentId("o2"))?.status).toBe("PROMOTED");
  });

  it("indexes a research claim with its topics", async () => {
    await processor.onOperations([
      op("c1", "bai/research-claim", 0, "CREATE_CLAIM",
        { title: "Claims must be atomic", kind: "research", topics: ["granularity", "linking"] },
        { title: "Claims must be atomic", kind: "research", topics: ["granularity", "linking"], methodology: [], sources: [], connections: [] }),
    ]);
    const c = await query.nodeByDocumentId("c1");
    expect(c).toMatchObject({ documentType: "bai/research-claim", noteType: "Claim (research)", status: "CANONICAL" });
    expect((await query.topicsForNode("c1")).sort()).toEqual(["granularity", "linking"]);
  });

  it("removes a node on the reactor's DELETE_DOCUMENT system action", async () => {
    await processor.onOperations([
      op("gone", "bai/tension", 0, "CREATE_TENSION",
        { title: "g", description: "d", involvedRefs: ["n1"], observedAt: T },
        { title: "g", involvedRefs: ["n1"], status: "OPEN" }),
    ]);
    expect(await query.nodeByDocumentId("gone")).toBeDefined();
    expect((await query.forwardLinks("gone")).length).toBe(1);
    await processor.onOperations([
      op("gone", "bai/tension", 1, "DELETE_DOCUMENT", { documentId: "gone" }, undefined, "document"),
    ]);
    expect(await query.nodeByDocumentId("gone")).toBeUndefined();
    expect((await query.forwardLinks("gone")).length).toBe(0);
    expect(await query.history("gone")).toEqual([]);
  });

  it("ignores document types outside the indexed set", async () => {
    await processor.onOperations([
      op("s1", "bai/source", 0, "INGEST_SOURCE", { title: "raw" }, { title: "raw", status: "INBOX" }),
    ]);
    expect(await query.nodeByDocumentId("s1")).toBeUndefined();
    expect(await query.history("s1")).toEqual([]);
  });

  it("mirrors ADD_RELATIONSHIP for indexed types only", async () => {
    await node("p", "bai/knowledge-note");
    await node("q", "bai/knowledge-note", { title: "Q" });
    await processor.onOperations([
      op("p", "bai/knowledge-note", 5, "ADD_RELATIONSHIP",
        { sourceId: "p", targetId: "q", relationshipType: "CONTRADICTS" }, undefined, "document"),
      op("drive", "powerhouse/document-drive", 6, "ADD_RELATIONSHIP",
        { sourceId: "drive", targetId: "q", relationshipType: "child" }, undefined, "document"),
    ]);
    const edges = await db.selectFrom("graph_edges").selectAll().execute();
    expect(edges.map((e) => [e.source_document_id, e.target_document_id, e.link_type, e.target_title])).toEqual([
      ["p", "q", "CONTRADICTS", "Q"],
    ]);
  });
});
