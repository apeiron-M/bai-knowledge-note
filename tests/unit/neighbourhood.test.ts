import { describe, expect, it, vi } from "vitest";
import {
  buildNeighbourhood,
  LINK_TYPE_WEIGHT,
} from "../../subgraphs/knowledge-graph/helpers/neighbourhood.js";
import type {
  GraphEdgeResult,
  GraphNodeResult,
} from "../../processors/graph-indexer/query.js";

const edge = (
  from: string,
  to: string,
  linkType: string,
  reason: string | null = null,
): GraphEdgeResult => ({
  id: `${from}->${to}:${linkType}`,
  sourceDocumentId: from,
  targetDocumentId: to,
  linkType,
  targetTitle: to.toUpperCase(),
  updatedAt: "2026-01-01T00:00:00.000Z",
  reason,
  confidence: reason ? "grounded" : null,
  metadataJson: null,
});

const node = (
  documentId: string,
  overrides: Partial<GraphNodeResult> = {},
): GraphNodeResult => ({
  id: documentId,
  documentId,
  title: documentId.toUpperCase(),
  description: `desc ${documentId}`,
  noteType: "concept",
  status: "CANONICAL",
  content: null,
  author: "a",
  sourceOrigin: "DERIVED",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  documentType: "bai/knowledge-note",
  ...overrides,
});

function fakeQuery(edges: GraphEdgeResult[], nodes: GraphNodeResult[]) {
  const byId = new Map(nodes.map((n) => [n.documentId, n]));
  return {
    edgesTouching: vi.fn(async (ids: string[]) =>
      edges.filter(
        (e) =>
          ids.includes(e.sourceDocumentId) || ids.includes(e.targetDocumentId),
      ),
    ),
    nodesByDocumentIds: vi.fn(
      async (ids: string[]) =>
        new Map(
          ids
            .map((id) => byId.get(id))
            .filter((n): n is GraphNodeResult => Boolean(n))
            .map((n) => [n.documentId, n]),
        ),
    ),
  };
}

const hit = (documentId: string, similarity: number) => ({
  documentId,
  similarity,
  node: { documentId, title: documentId.toUpperCase() },
});

describe("buildNeighbourhood", () => {
  it("reads the whole neighbourhood in two queries regardless of hit count", async () => {
    const query = fakeQuery(
      [edge("h1", "x", "RELATES_TO"), edge("h2", "y", "RELATES_TO")],
      [node("x"), node("y")],
    );
    await buildNeighbourhood(query, [
      hit("h1", 0.9),
      hit("h2", 0.8),
      hit("h3", 0.7),
    ]);
    expect(query.edgesTouching).toHaveBeenCalledTimes(1);
    expect(query.nodesByDocumentIds).toHaveBeenCalledTimes(1);
    expect(query.edgesTouching).toHaveBeenCalledWith(["h1", "h2", "h3"]);
  });

  it("returns nothing for no hits, and never queries", async () => {
    const query = fakeQuery([], []);
    const graph = await buildNeighbourhood(query, []);
    expect(graph.related).toEqual([]);
    expect(query.edgesTouching).not.toHaveBeenCalled();
  });

  it("ranks a node several hits point at above one only a single hit points at", async () => {
    const query = fakeQuery(
      [
        edge("h1", "shared", "RELATES_TO"),
        edge("h2", "shared", "RELATES_TO"),
        edge("h1", "lonely", "RELATES_TO"),
      ],
      [node("shared"), node("lonely")],
    );
    const graph = await buildNeighbourhood(query, [
      hit("h1", 0.9),
      hit("h2", 0.9),
    ]);
    expect(graph.related.map((r) => r.documentId)).toEqual([
      "shared",
      "lonely",
    ]);
    expect(graph.related[0].hitCount).toBe(2);
    expect(graph.related[1].hitCount).toBe(1);
  });

  it("sorts a CONTRADICTS neighbour above a RELATES_TO one from the same hit", async () => {
    const query = fakeQuery(
      [edge("h1", "soft", "RELATES_TO"), edge("h1", "disputed", "CONTRADICTS")],
      [node("soft"), node("disputed")],
    );
    const graph = await buildNeighbourhood(query, [hit("h1", 0.9)]);
    expect(graph.related[0].documentId).toBe("disputed");
    expect(LINK_TYPE_WEIGHT.CONTRADICTS).toBeGreaterThan(
      LINK_TYPE_WEIGHT.RELATES_TO,
    );
  });

  it("keeps edges between hits out of related and reports them as links", async () => {
    const query = fakeQuery(
      [edge("h1", "h2", "BUILDS_ON"), edge("h1", "x", "RELATES_TO")],
      [node("x")],
    );
    const graph = await buildNeighbourhood(query, [
      hit("h1", 0.9),
      hit("h2", 0.8),
    ]);
    expect(graph.related.map((r) => r.documentId)).toEqual(["x"]);
    expect(graph.links).toHaveLength(1);
    expect(graph.links[0]).toMatchObject({
      from: "h1",
      to: "h2",
      linkType: "BUILDS_ON",
    });
  });

  it("files a hit-to-hit edge under BOTH of its ends", async () => {
    // The case that matters: search returns both sides of a disagreement, so
    // the CONTRADICTS edge joining them is invisible in `related` — which
    // excludes hits by construction — and must be reachable from either end.
    const query = fakeQuery(
      [edge("h1", "h2", "CONTRADICTS", "h1 disputes h2's claim about scope")],
      [],
    );
    const graph = await buildNeighbourhood(query, [
      hit("h1", 0.9),
      hit("h2", 0.88),
    ]);
    expect(graph.related).toEqual([]);
    expect(graph.linksByHit.h1).toHaveLength(1);
    expect(graph.linksByHit.h2).toHaveLength(1);
    expect(graph.linksByHit.h1[0]).toMatchObject({
      from: "h1",
      to: "h2",
      linkType: "CONTRADICTS",
      reason: "h1 disputes h2's claim about scope",
    });
    // Both ends report the SAME edge, source -> target, not a mirrored copy.
    expect(graph.linksByHit.h2[0]).toEqual(graph.linksByHit.h1[0]);
  });

  it("gives every hit a linksByHit entry, empty when it links to no other hit", async () => {
    const query = fakeQuery(
      [edge("h1", "h2", "BUILDS_ON"), edge("h3", "x", "RELATES_TO")],
      [node("x")],
    );
    const graph = await buildNeighbourhood(query, [
      hit("h1", 0.9),
      hit("h2", 0.8),
      hit("h3", 0.7),
    ]);
    expect(Object.keys(graph.linksByHit).sort()).toEqual(["h1", "h2", "h3"]);
    expect(graph.linksByHit.h3).toEqual([]);
  });

  it("does not file a self-edge under linksByHit", async () => {
    const query = fakeQuery([edge("h1", "h1", "RELATES_TO")], [node("h1")]);
    const graph = await buildNeighbourhood(query, [hit("h1", 0.9)]);
    expect(graph.linksByHit.h1).toEqual([]);
  });

  it("caps one hit's contribution so a MoC cannot fill the list", async () => {
    const members = Array.from({ length: 40 }, (_, i) => `m${i}`);
    const query = fakeQuery(
      [
        ...members.map((m) => edge("moc", m, "CORE_IDEA")),
        edge("h2", "other", "RELATES_TO"),
      ],
      [...members.map((m) => node(m)), node("other")],
    );
    const graph = await buildNeighbourhood(
      query,
      [hit("moc", 0.95), hit("h2", 0.5)],
      { limit: 50, perHitEdgeCap: 15 },
    );
    const fromMoc = graph.related.filter((r) => r.documentId.startsWith("m"));
    expect(fromMoc).toHaveLength(15);
    expect(graph.related.map((r) => r.documentId)).toContain("other");
  });

  it("truncates to the limit and reports the total it found", async () => {
    const others = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const query = fakeQuery(
      others.map((n) => edge("h1", n, "RELATES_TO")),
      others.map((n) => node(n)),
    );
    const graph = await buildNeighbourhood(query, [hit("h1", 0.9)], {
      limit: 4,
      perHitEdgeCap: 20,
    });
    expect(graph.related).toHaveLength(4);
    expect(graph.totalRelated).toBe(12);
    expect(graph.truncated).toBe(true);
  });

  it("drops archived neighbours unless asked for them", async () => {
    const edges = [edge("h1", "old", "SUPERSEDES")];
    const nodes = [node("old", { status: "ARCHIVED" })];
    const hidden = await buildNeighbourhood(fakeQuery(edges, nodes), [
      hit("h1", 0.9),
    ]);
    expect(hidden.related).toEqual([]);

    const shown = await buildNeighbourhood(fakeQuery(edges, nodes), [
      hit("h1", 0.9),
    ], { includeArchived: true });
    expect(shown.related.map((r) => r.documentId)).toEqual(["old"]);
  });

  it("drops an edge whose other end is not in the index", async () => {
    // DERIVED_FROM points at a source document, which is never indexed.
    const query = fakeQuery([edge("h1", "src", "DERIVED_FROM")], []);
    const graph = await buildNeighbourhood(query, [hit("h1", 0.9)]);
    expect(graph.related).toEqual([]);
    expect(graph.totalRelated).toBe(0);
  });

  it("writes via as source -> target with both titles resolved", async () => {
    const query = fakeQuery(
      [edge("parent", "h1", "CORE_IDEA", "h1 is a core idea of parent")],
      [node("parent", { title: "Parent MoC", documentType: "bai/moc" })],
    );
    const graph = await buildNeighbourhood(query, [hit("h1", 0.9)]);
    expect(graph.related[0].via[0]).toEqual({
      from: "parent",
      fromTitle: "Parent MoC",
      to: "h1",
      toTitle: "H1",
      linkType: "CORE_IDEA",
      reason: "h1 is a core idea of parent",
      confidence: "grounded",
    });
  });

  it("groups per hit with via narrowed to that hit, keeping global order", async () => {
    const query = fakeQuery(
      [
        edge("h1", "shared", "RELATES_TO"),
        edge("h2", "shared", "RELATES_TO"),
        edge("h2", "only2", "RELATES_TO"),
      ],
      [node("shared"), node("only2")],
    );
    const graph = await buildNeighbourhood(query, [
      hit("h1", 0.9),
      hit("h2", 0.9),
    ]);
    expect(graph.byHit.h1.map((r) => r.documentId)).toEqual(["shared"]);
    expect(graph.byHit.h2.map((r) => r.documentId)).toEqual([
      "shared",
      "only2",
    ]);
    // h1's copy of `shared` shows only h1's edge, not h2's.
    expect(graph.byHit.h1[0].via).toHaveLength(1);
    expect(graph.byHit.h1[0].via[0].from).toBe("h1");
    // but the global convergence count is preserved
    expect(graph.byHit.h1[0].hitCount).toBe(2);
  });

  it("ignores a self-edge rather than listing the hit as its own neighbour", async () => {
    const query = fakeQuery([edge("h1", "h1", "RELATES_TO")], [node("h1")]);
    const graph = await buildNeighbourhood(query, [hit("h1", 0.9)]);
    expect(graph.related).toEqual([]);
    expect(graph.links).toEqual([]);
  });

  it("gives an articulated edge a higher score than a bare one", async () => {
    const query = fakeQuery(
      [
        edge("h1", "bare", "RELATES_TO"),
        edge("h1", "said-why", "RELATES_TO", "because it explains the cache"),
      ],
      [node("bare"), node("said-why")],
    );
    const graph = await buildNeighbourhood(query, [hit("h1", 0.9)]);
    expect(graph.related[0].documentId).toBe("said-why");
  });
});
