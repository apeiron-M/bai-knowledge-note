import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { up, down } from "../../processors/graph-indexer/migrations.js";
import {
  createGraphQuery,
  normalizeFusedScore,
  RRF_K,
} from "../../processors/graph-indexer/query.js";

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
  await db.deleteFrom("graph_edges").execute();
  await db.deleteFrom("graph_nodes").execute();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

interface SeedNodeInput {
  id: string;
  document_id: string;
  title: string;
  status?: string;
}

async function seedNodes(...nodes: SeedNodeInput[]): Promise<void> {
  await db
    .insertInto("graph_nodes")
    .values(
      nodes.map((n) => ({
        id: n.id,
        document_id: n.document_id,
        title: n.title,
        description: null,
        note_type: null,
        status: n.status ?? "CANONICAL",
        updated_at: "2024-01-01T00:00:00Z",
      })),
    )
    .execute();
}

/**
 * Seeds one edge. The default `link_type` is a real knowledge type because
 * that is what the projection now stores — only the canonical knowledge
 * relationship types are indexed, and every analytics query filters on them
 * (see processors/graph-indexer/link-types.ts). Tests that care about
 * containment pass `"child"` explicitly.
 *
 * The id mirrors the processor's own `source-target-type` scheme so a
 * containment edge and a knowledge edge over the same pair can coexist.
 */
async function seedEdge(
  source: string,
  target: string,
  linkType: string | null = "RELATES_TO",
): Promise<void> {
  await db
    .insertInto("graph_edges")
    .values({
      id: `${source}-${target}-${linkType ?? "_"}`,
      source_document_id: source,
      target_document_id: target,
      link_type: linkType,
      target_title: null,
      updated_at: "2024-01-01T00:00:00Z",
    })
    .execute();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("allNodes()", () => {
  it("returns all seeded nodes", async () => {
    await seedNodes(
      { id: "n1", document_id: "a", title: "Node A" },
      { id: "n2", document_id: "b", title: "Node B" },
      { id: "n3", document_id: "c", title: "Node C" },
    );

    const nodes = await query.allNodes();
    expect(nodes).toHaveLength(3);
    const docIds = nodes.map((n) => n.documentId).sort();
    expect(docIds).toEqual(["a", "b", "c"]);
  });
});

describe("nodeByDocumentId()", () => {
  it("returns the correct node for a given document id", async () => {
    await seedNodes(
      { id: "n1", document_id: "a", title: "Node A" },
      { id: "n2", document_id: "b", title: "Node B" },
    );

    const node = await query.nodeByDocumentId("b");
    expect(node).toBeDefined();
    expect(node!.documentId).toBe("b");
    expect(node!.title).toBe("Node B");
  });

  it("returns undefined for a non-existent document id", async () => {
    const node = await query.nodeByDocumentId("does-not-exist");
    expect(node).toBeUndefined();
  });
});

describe("nodesByStatus()", () => {
  it("filters nodes by status correctly", async () => {
    await seedNodes(
      { id: "n1", document_id: "a", title: "Node A", status: "CANONICAL" },
      { id: "n2", document_id: "b", title: "Node B", status: "DRAFT" },
      { id: "n3", document_id: "c", title: "Node C", status: "CANONICAL" },
    );

    const canonical = await query.nodesByStatus("CANONICAL");
    expect(canonical).toHaveLength(2);
    const docIds = canonical.map((n) => n.documentId).sort();
    expect(docIds).toEqual(["a", "c"]);

    const drafts = await query.nodesByStatus("DRAFT");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].documentId).toBe("b");
  });
});

describe("orphanNodes()", () => {
  it("returns nodes with no incoming edges (A and C when only A→B exists)", async () => {
    // A→B means B has an incoming edge, so B is NOT an orphan
    // A and C have no incoming edges, so they ARE orphans
    await seedNodes(
      { id: "n1", document_id: "a", title: "Node A" },
      { id: "n2", document_id: "b", title: "Node B" },
      { id: "n3", document_id: "c", title: "Node C" },
    );
    await seedEdge("a", "b");

    const orphans = await query.orphanNodes();
    expect(orphans).toHaveLength(2);
    const docIds = orphans.map((n) => n.documentId).sort();
    expect(docIds).toEqual(["a", "c"]);
  });
});

describe("stats()", () => {
  it("returns correct nodeCount, edgeCount, and orphanCount", async () => {
    await seedNodes(
      { id: "n1", document_id: "a", title: "Node A" },
      { id: "n2", document_id: "b", title: "Node B" },
      { id: "n3", document_id: "c", title: "Node C" },
    );
    // A→B and B→C: B and C are targets, so A is the only orphan
    await seedEdge("a", "b");
    await seedEdge("b", "c");

    const stats = await query.stats();
    expect(stats.nodeCount).toBe(3);
    expect(stats.edgeCount).toBe(2);
    expect(stats.orphanCount).toBe(1); // only A has no incoming edge
  });
});

describe("connections()", () => {
  it("BFS: returns B at depth 1 and C at depth 2 for A→B→C", async () => {
    await seedNodes(
      { id: "n1", document_id: "a", title: "Node A" },
      { id: "n2", document_id: "b", title: "Node B" },
      { id: "n3", document_id: "c", title: "Node C" },
    );
    await seedEdge("a", "b");
    await seedEdge("b", "c");

    const conns = await query.connections("a", 2);
    expect(conns).toHaveLength(2);

    const b = conns.find((c) => c.node.documentId === "b");
    const c = conns.find((c) => c.node.documentId === "c");

    expect(b).toBeDefined();
    expect(b!.depth).toBe(1);

    expect(c).toBeDefined();
    expect(c!.depth).toBe(2);
  });

  it("returns every branch of a fan-out at one depth", async () => {
    await seedNodes(
      { id: "n1", document_id: "a", title: "Node A" },
      { id: "n2", document_id: "b", title: "Node B" },
      { id: "n3", document_id: "c", title: "Node C" },
      { id: "n4", document_id: "d", title: "Node D" },
    );
    await seedEdge("a", "b");
    await seedEdge("a", "c");
    await seedEdge("a", "d");

    const conns = await query.connections("a", 1);
    expect(conns.map((c) => c.node.documentId).sort()).toEqual([
      "b",
      "c",
      "d",
    ]);
    expect(conns.every((c) => c.depth === 1)).toBe(true);
  });

  it("reaches a node once, by its shallowest edge", async () => {
    // Both A→C and A→B→C exist; C must appear once, at depth 1.
    await seedNodes(
      { id: "n1", document_id: "a", title: "Node A" },
      { id: "n2", document_id: "b", title: "Node B" },
      { id: "n3", document_id: "c", title: "Node C" },
    );
    await seedEdge("a", "b");
    await seedEdge("a", "c");
    await seedEdge("b", "c");

    const conns = await query.connections("a", 2);
    const cs = conns.filter((c) => c.node.documentId === "c");
    expect(cs).toHaveLength(1);
    expect(cs[0].depth).toBe(1);
  });

  it("skips a dangling edge and does not traverse through it", async () => {
    // A→ghost has no node row; A→b does. The walk must still reach b, and
    // must not emit a result for ghost.
    await seedNodes(
      { id: "n1", document_id: "a", title: "Node A" },
      { id: "n2", document_id: "b", title: "Node B" },
      { id: "n3", document_id: "c", title: "Node C" },
    );
    await seedEdge("a", "ghost");
    await seedEdge("a", "b");
    await seedEdge("ghost", "c");

    const conns = await query.connections("a", 2);
    expect(conns.map((c) => c.node.documentId)).toEqual(["b"]);
  });

  it("respects maxDepth: connections('a', 1) returns only B", async () => {
    await seedNodes(
      { id: "n1", document_id: "a", title: "Node A" },
      { id: "n2", document_id: "b", title: "Node B" },
      { id: "n3", document_id: "c", title: "Node C" },
    );
    await seedEdge("a", "b");
    await seedEdge("b", "c");

    const conns = await query.connections("a", 1);
    expect(conns).toHaveLength(1);
    expect(conns[0].node.documentId).toBe("b");
    expect(conns[0].depth).toBe(1);
  });
});

describe("backlinks()", () => {
  it("returns edges pointing to the given document id", async () => {
    await seedNodes(
      { id: "n1", document_id: "a", title: "Node A" },
      { id: "n2", document_id: "b", title: "Node B" },
    );
    await seedEdge("a", "b", "BUILDS_ON");

    const links = await query.backlinks("b");
    expect(links).toHaveLength(1);
    expect(links[0].sourceDocumentId).toBe("a");
    expect(links[0].targetDocumentId).toBe("b");
    expect(links[0].linkType).toBe("BUILDS_ON");
  });

  it("returns empty array when no edges point to the document", async () => {
    await seedNodes({ id: "n1", document_id: "a", title: "Node A" });

    const links = await query.backlinks("a");
    expect(links).toHaveLength(0);
  });
});

describe("density()", () => {
  it("returns correct density with 3 nodes and 3 edges", async () => {
    // density = edges / (n * (n-1)) = 3 / (3 * 2) = 3/6 = 0.5
    await seedNodes(
      { id: "n1", document_id: "a", title: "Node A" },
      { id: "n2", document_id: "b", title: "Node B" },
      { id: "n3", document_id: "c", title: "Node C" },
    );
    await seedEdge("a", "b");
    await seedEdge("b", "c");
    await seedEdge("a", "c");

    const d = await query.density();
    expect(d).toBeCloseTo(0.5);
  });

  it("returns 0 with only 1 node", async () => {
    await seedNodes({ id: "n1", document_id: "a", title: "Node A" });

    const d = await query.density();
    expect(d).toBe(0);
  });

  it("returns 0 with no nodes", async () => {
    const d = await query.density();
    expect(d).toBe(0);
  });
});

describe("normalizeFusedScore()", () => {
  // Regression: the RRF score was handed straight to the UI as `similarity`
  // and rendered as `score * 100`. Because each leg contributes only
  // 1/(60+rank), the BEST attainable two-leg score is 2/60 = 0.0333 — so a
  // perfect match displayed as "3%" and nothing could ever score higher.
  it("documents the 3% ceiling the raw fused score produced", () => {
    const bestPossibleRaw = 2 / RRF_K;
    expect(Math.round(bestPossibleRaw * 100)).toBe(3);
    // ...and that same perfect match now reads as 100%.
    expect(normalizeFusedScore(bestPossibleRaw, 2)).toBe(1);
  });

  it("scores a hit found by one leg against a single leg's ceiling", () => {
    // One leg, rank 0 => the best a single-leg search can do => 1.0.
    expect(normalizeFusedScore(1 / RRF_K, 1)).toBe(1);
    // The same score judged against a two-leg ceiling is only half of it.
    expect(normalizeFusedScore(1 / RRF_K, 2)).toBeCloseTo(0.5, 6);
  });

  it("stays within 0..1 and never inverts the ranking", () => {
    const raws = [2 / RRF_K, 1 / RRF_K + 1 / (RRF_K + 5), 1 / RRF_K, 1 / (RRF_K + 40)];
    const scaled = raws.map((r) => normalizeFusedScore(r, 2));
    for (const v of scaled) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Monotonic: strictly decreasing input stays strictly decreasing.
    for (let i = 1; i < scaled.length; i++) {
      expect(scaled[i]).toBeLessThan(scaled[i - 1]);
    }
  });

  it("clamps degenerate input instead of emitting NaN or >1", () => {
    expect(normalizeFusedScore(0, 2)).toBe(0);
    expect(normalizeFusedScore(-1, 2)).toBe(0);
    expect(normalizeFusedScore(Number.NaN, 2)).toBe(0);
    expect(normalizeFusedScore(999, 2)).toBe(1);
    expect(normalizeFusedScore(1 / RRF_K, 0)).toBe(0);
  });
});

describe("nodesByDocumentIds()", () => {
  it("resolves many ids in one call", async () => {
    await seedNodes(
      { id: "n1", document_id: "a", title: "Alpha" },
      { id: "n2", document_id: "b", title: "Beta" },
      { id: "n3", document_id: "c", title: "Gamma" },
    );
    const found = await query.nodesByDocumentIds(["a", "c"]);
    expect([...found.keys()].sort()).toEqual(["a", "c"]);
    expect(found.get("a")?.title).toBe("Alpha");
    expect(found.get("c")?.title).toBe("Gamma");
  });

  it("returns an empty map for no ids, without querying", async () => {
    await expect(query.nodesByDocumentIds([])).resolves.toEqual(new Map());
  });

  it("omits ids that do not exist rather than yielding undefined entries", async () => {
    await seedNodes({ id: "n1", document_id: "a", title: "Alpha" });
    const found = await query.nodesByDocumentIds(["a", "missing"]);
    expect(found.size).toBe(1);
    expect(found.has("missing")).toBe(false);
  });

  it("agrees with nodeByDocumentId one id at a time", async () => {
    await seedNodes(
      { id: "n1", document_id: "a", title: "Alpha" },
      { id: "n2", document_id: "b", title: "Beta" },
    );
    const batch = await query.nodesByDocumentIds(["a", "b"]);
    for (const id of ["a", "b"]) {
      expect(batch.get(id)).toEqual(await query.nodeByDocumentId(id));
    }
  });
});

describe("fullSearch() relevance ordering", () => {
  // Regression: fullSearch had no ORDER BY, so a body-only mention could
  // outrank a title match, or fall outside the limit window entirely.
  it("ranks title matches above description above body", async () => {
    await db
      .insertInto("graph_nodes")
      .values([
        {
          id: "n1",
          document_id: "body",
          title: "Unrelated analytics note",
          description: null,
          content: "mentions construction somewhere deep in the body",
          note_type: null,
          status: "CANONICAL",
          updated_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "n2",
          document_id: "desc",
          title: "Another note",
          description: "about construction sequencing",
          content: null,
          note_type: null,
          status: "CANONICAL",
          updated_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "n3",
          document_id: "title",
          title: "Construction and BIM",
          description: null,
          content: null,
          note_type: null,
          status: "CANONICAL",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ])
      .execute();

    const rows = await query.fullSearch("construction", 10);
    expect(rows.map((r) => r.documentId)).toEqual(["title", "desc", "body"]);
  });

  it("keeps a title match inside a tight limit window", async () => {
    // Ten body-only mentions plus one title match. Unordered, the title
    // match could be evicted by the limit; ranked, it must survive.
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `b${i}`,
      document_id: `body${i}`,
      title: `Filler note ${i}`,
      description: null,
      content: "incidental construction mention",
      note_type: null,
      status: "CANONICAL",
      updated_at: "2024-01-01T00:00:00Z",
    }));
    await db
      .insertInto("graph_nodes")
      .values([
        ...rows,
        {
          id: "t1",
          document_id: "the-title",
          title: "Construction handbook",
          description: null,
          content: null,
          note_type: null,
          status: "CANONICAL",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ])
      .execute();

    const top = await query.fullSearch("construction", 3);
    expect(top[0].documentId).toBe("the-title");
  });
});

// ── bridges(): articulation points via Tarjan ────────────────────────────────

/**
 * Brute force: a node is an articulation point when removing it leaves more
 * connected components than before. This is the definition, and it is what
 * `bridges()` used to compute directly (O(V*(V+E))). Kept here as the oracle
 * the fast implementation is checked against — the optimisation is only worth
 * anything if the two never disagree.
 */
function bruteForceArticulationPoints(
  edges: [string, string][],
): Set<string> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const set = adj.get(a);
    if (set) set.add(b);
    else adj.set(a, new Set([b]));
  };
  for (const [a, b] of edges) {
    if (a === b) {
      if (!adj.has(a)) adj.set(a, new Set());
      continue;
    }
    link(a, b);
    link(b, a);
  }
  const nodes = [...adj.keys()];
  if (nodes.length <= 2) return new Set();

  const countComponents = (exclude: string): number => {
    const seen = new Set<string>();
    let components = 0;
    for (const start of nodes) {
      if (start === exclude || seen.has(start)) continue;
      components++;
      const stack = [start];
      while (stack.length) {
        const cur = stack.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const nb of adj.get(cur) ?? []) {
          if (nb !== exclude && !seen.has(nb)) stack.push(nb);
        }
      }
    }
    return components;
  };

  const base = countComponents("");
  const out = new Set<string>();
  for (const node of nodes) {
    if (countComponents(node) > base) out.add(node);
  }
  return out;
}

async function seedGraph(edges: [string, string][]): Promise<void> {
  const ids = [...new Set(edges.flat())];
  await seedNodes(
    ...ids.map((id, i) => ({
      id: `n${i}`,
      document_id: id,
      title: `Node ${id}`,
    })),
  );
  for (const [a, b] of edges) await seedEdge(a, b);
}

describe("bridges() — articulation points", () => {
  it("finds the middle of a path", async () => {
    await seedGraph([
      ["a", "b"],
      ["b", "c"],
    ]);
    // a-b-c: removing b splits a from c. Only 3 nodes, so this also proves
    // the >2 guard does not swallow a legitimate answer.
    const ap = await query.bridges();
    expect(ap.map((n) => n.documentId)).toEqual(["b"]);
  });

  it("finds nothing in a cycle", async () => {
    await seedGraph([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
    ]);
    expect(await query.bridges()).toEqual([]);
  });

  it("finds the hinge joining two triangles", async () => {
    await seedGraph([
      ["a", "b"],
      ["b", "h"],
      ["h", "a"],
      ["h", "x"],
      ["x", "y"],
      ["y", "h"],
    ]);
    const ap = await query.bridges();
    expect(ap.map((n) => n.documentId)).toEqual(["h"]);
  });

  it("finds the centre of a star", async () => {
    await seedGraph([
      ["hub", "a"],
      ["hub", "b"],
      ["hub", "c"],
      ["hub", "d"],
    ]);
    const ap = await query.bridges();
    expect(ap.map((n) => n.documentId)).toEqual(["hub"]);
  });

  it("handles two disconnected components independently", async () => {
    await seedGraph([
      ["a", "b"],
      ["b", "c"],
      ["p", "q"],
      ["q", "r"],
      ["r", "p"],
    ]);
    const ap = await query.bridges();
    // b is a hinge; the p-q-r triangle has none. Each DFS root is handled
    // separately, which is the part a single-root implementation gets wrong.
    expect(ap.map((n) => n.documentId)).toEqual(["b"]);
  });

  it("ignores a self-loop", async () => {
    await seedGraph([
      ["a", "b"],
      ["b", "c"],
      ["b", "b"],
    ]);
    const ap = await query.bridges();
    expect(ap.map((n) => n.documentId)).toEqual(["b"]);
  });

  it("returns nothing for a graph of two nodes", async () => {
    await seedGraph([["a", "b"]]);
    expect(await query.bridges()).toEqual([]);
  });

  it("ignores non-knowledge edges", async () => {
    await seedNodes(
      { id: "n1", document_id: "a", title: "A" },
      { id: "n2", document_id: "b", title: "B" },
      { id: "n3", document_id: "c", title: "C" },
    );
    await seedEdge("a", "b", "child");
    await seedEdge("b", "c", "child");
    // Containment only: no knowledge graph, so no articulation points.
    expect(await query.bridges()).toEqual([]);
  });

  it("agrees with brute force on 40 random graphs", async () => {
    // Deterministic PRNG so a failure is reproducible.
    let seed = 0x2f6e2b1;
    const rand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return Math.abs(seed) / 0x7fffffff;
    };

    for (let round = 0; round < 40; round++) {
      await db.deleteFrom("graph_edges").execute();
      await db.deleteFrom("graph_nodes").execute();

      const size = 4 + Math.floor(rand() * 9); // 4..12 nodes
      const ids = Array.from({ length: size }, (_, i) => `v${i}`);
      const edges: [string, string][] = [];
      const seen = new Set<string>();
      // Sparse enough that articulation points actually occur; dense graphs
      // are all one biconnected blob and prove nothing.
      const target = size + Math.floor(rand() * size);
      for (let e = 0; e < target; e++) {
        const a = ids[Math.floor(rand() * size)];
        const b = ids[Math.floor(rand() * size)];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (a === b || seen.has(key)) continue;
        seen.add(key);
        edges.push([a, b]);
      }
      if (edges.length === 0) continue;

      await seedGraph(edges);
      const actual = new Set((await query.bridges()).map((n) => n.documentId));
      const expected = bruteForceArticulationPoints(edges);
      expect({ round, ap: [...actual].sort() }).toEqual({
        round,
        ap: [...expected].sort(),
      });
    }
  });
});
