import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { up, down } from "../../processors/graph-indexer/migrations.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";

let db: Kysely<DB>;
let query: ReturnType<typeof createGraphQuery>;

beforeAll(async () => {
  const pglite = new PGlite();
  db = new Kysely<DB>({ dialect: new PGliteDialect(pglite) });
  await up(db as any);
  query = createGraphQuery(db);
});

afterAll(async () => {
  await down(db as any);
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

async function seedEdge(
  source: string,
  target: string,
  linkType: string | null = null,
): Promise<void> {
  await db
    .insertInto("graph_edges")
    .values({
      id: `${source}-${target}`,
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
    await seedEdge("a", "b", "references");

    const links = await query.backlinks("b");
    expect(links).toHaveLength(1);
    expect(links[0].sourceDocumentId).toBe("a");
    expect(links[0].targetDocumentId).toBe("b");
    expect(links[0].linkType).toBe("references");
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
