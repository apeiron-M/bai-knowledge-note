/**
 * Containment edges must not be knowledge edges.
 *
 * The reactor reuses `ADD_RELATIONSHIP` for its own drive bookkeeping: adding
 * a file to a drive emits `(drive, document, "child")`. The graph-indexer used
 * to mirror every relationship type into `graph_edges`, so the projection
 * carried one containment edge from the drive to every document in the vault.
 *
 * Measured on the live vault before the fix:
 *
 *   nodeCount 1502, edgeCount 9092, orphanCount 0
 *   by link type: RELATES_TO 3224, CORE_IDEA 2837, child 1530,
 *                 DERIVED_FROM 1479, CHILD_MOC 22
 *   all 1530 `child` rows had sourceDocumentId == the drive id
 *
 * `orphanCount: 0` was therefore a structural artifact, not a finding — the
 * drive pointed at everything, so no node could ever lack an incoming edge,
 * and the vault health report's ORPHAN_DETECTION check had been passing on a
 * meaningless zero. `edgeCount` and density were ~20% too high.
 *
 * These tests pin the whole contract: what gets indexed, what each analytics
 * query counts, and that a reindex clears legacy rows.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { up, down } from "../../processors/graph-indexer/migrations.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";
import {
  KNOWLEDGE_LINK_TYPES,
  isKnowledgeLinkType,
} from "../../processors/graph-indexer/link-types.js";
import { pruneNonKnowledgeEdges } from "../../subgraphs/knowledge-graph/helpers/reindex.js";

let db: Kysely<DB>;
let query: ReturnType<typeof createGraphQuery>;

/** Stands in for the drive document — deliberately never given a node row,
 * exactly like the real thing (the processor only indexes notes and MoCs). */
const DRIVE = "drive-91c6c86b";

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

async function seedNotes(...docIds: string[]): Promise<void> {
  await db
    .insertInto("graph_nodes")
    .values(
      docIds.map((id) => ({
        id,
        document_id: id,
        title: `Note ${id}`,
        description: null,
        note_type: null,
        status: "CANONICAL",
        updated_at: "2024-01-01T00:00:00Z",
      })),
    )
    .execute();
}

async function seedEdge(
  source: string,
  target: string,
  linkType: string | null,
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

/** The live vault's shape in miniature: the drive contains every note, and
 * only `b` has a real incoming link. */
async function seedVault(): Promise<void> {
  await seedNotes("a", "b", "c");
  for (const id of ["a", "b", "c"]) await seedEdge(DRIVE, id, "child");
  await seedEdge("a", "b", "RELATES_TO");
}

describe("isKnowledgeLinkType()", () => {
  it("accepts every canonical knowledge type", () => {
    for (const t of KNOWLEDGE_LINK_TYPES) {
      expect(isKnowledgeLinkType(t)).toBe(true);
    }
  });

  it("rejects reactor bookkeeping types, unknown types, and no type at all", () => {
    expect(isKnowledgeLinkType("child")).toBe(false);
    expect(isKnowledgeLinkType("contains")).toBe(false);
    expect(isKnowledgeLinkType("relates_to")).toBe(false); // case-sensitive
    expect(isKnowledgeLinkType("")).toBe(false);
    expect(isKnowledgeLinkType(null)).toBe(false);
    expect(isKnowledgeLinkType(undefined)).toBe(false);
  });
});

describe("orphanNodes()", () => {
  it("reports a node whose ONLY incoming edge is containment", async () => {
    await seedVault();

    const orphans = (await query.orphanNodes()).map((n) => n.documentId).sort();
    // `b` is linked from `a`; `a` and `c` are only "linked" by the drive.
    expect(orphans).toEqual(["a", "c"]);
  });

  it("does not report a node with a real incoming knowledge edge", async () => {
    await seedVault();

    const orphans = await query.orphanNodes();
    expect(orphans.map((n) => n.documentId)).not.toContain("b");
  });

  it("can return non-zero even when the drive links to every node", async () => {
    // Regression: this was structurally impossible. `orphanCount: 0` on a
    // 1502-node vault was the drive's containment edges, not connectivity.
    await seedVault();

    expect((await query.orphanNodes()).length).toBeGreaterThan(0);
  });

  it("counts a node whose only incoming edge is UNTYPED as an orphan", async () => {
    // `link_type` is nullable, and an untyped relationship is deliberately
    // not a knowledge link — every link the vault authors carries a type.
    await seedNotes("a", "b");
    await seedEdge("a", "b", null);

    const orphans = (await query.orphanNodes()).map((n) => n.documentId).sort();
    expect(orphans).toEqual(["a", "b"]);
  });

  it("still returns rows when a NULL link_type is present", async () => {
    // The old predicate was `document_id not in (select target_document_id
    // ...)`. Postgres evaluates `x NOT IN (...)` to NULL — matching nothing —
    // as soon as the subquery yields one NULL, so a single malformed row could
    // silently zero the orphan list. NOT EXISTS is immune.
    await seedNotes("a", "b", "c");
    await seedEdge("a", "b", null);
    await seedEdge("a", "c", "DERIVED_FROM");

    const orphans = (await query.orphanNodes()).map((n) => n.documentId).sort();
    expect(orphans).toEqual(["a", "b"]);
  });

  it("agrees with stats().orphanCount", async () => {
    await seedVault();

    const [orphans, stats] = await Promise.all([
      query.orphanNodes(),
      query.stats(),
    ]);
    expect(stats.orphanCount).toBe(orphans.length);
  });
});

describe("stats() and density()", () => {
  it("excludes containment edges from edgeCount", async () => {
    await seedVault();

    const stats = await query.stats();
    expect(stats.nodeCount).toBe(3);
    expect(stats.edgeCount).toBe(1); // 1 knowledge edge, 3 containment rows
    expect(stats.orphanCount).toBe(2);
  });

  it("excludes untyped edges from edgeCount", async () => {
    await seedNotes("a", "b", "c");
    await seedEdge("a", "b", "RELATES_TO");
    await seedEdge("a", "c", null);

    expect((await query.stats()).edgeCount).toBe(1);
  });

  it("computes density from knowledge edges only", async () => {
    await seedNotes("a", "b", "c");
    await seedEdge("a", "b", "RELATES_TO");
    await seedEdge("b", "c", "BUILDS_ON");
    await seedEdge("a", "c", "CONTRADICTS");
    for (const id of ["a", "b", "c"]) await seedEdge(DRIVE, id, "child");

    // 3 knowledge edges / (3 * 2) = 0.5. Counting the 3 containment rows too
    // would double it.
    expect(await query.density()).toBeCloseTo(0.5);
  });

  it("uses the same edge population as stats().edgeCount", async () => {
    await seedVault();

    const stats = await query.stats();
    const expected = stats.edgeCount / (stats.nodeCount * (stats.nodeCount - 1));
    expect(await query.density()).toBeCloseTo(expected);
  });
});

describe("link queries", () => {
  it("backlinks() omits the phantom backlink from the drive", async () => {
    await seedVault();

    const links = await query.backlinks("b");
    expect(links).toHaveLength(1);
    expect(links[0].sourceDocumentId).toBe("a");
    expect(links.map((l) => l.sourceDocumentId)).not.toContain(DRIVE);
  });

  it("backlinks() is empty for a note only the drive points at", async () => {
    await seedVault();

    expect(await query.backlinks("c")).toHaveLength(0);
  });

  it("forwardLinks() returns nothing for the drive itself", async () => {
    await seedVault();

    expect(await query.forwardLinks(DRIVE)).toHaveLength(0);
  });

  it("allEdges() returns knowledge edges only", async () => {
    await seedVault();

    const edges = await query.allEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0].linkType).toBe("RELATES_TO");
  });

  it("connections() does not walk the whole vault from the drive", async () => {
    await seedVault();

    expect(await query.connections(DRIVE, 2)).toHaveLength(0);
    // ...while a real link is still traversed.
    const fromA = await query.connections("a", 2);
    expect(fromA.map((c) => c.node.documentId)).toEqual(["b"]);
  });
});

describe("structural analyses", () => {
  it("bridges() still finds the real articulation point", async () => {
    // a—b—c: removing `b` splits the graph, so `b` is a bridge. Containment
    // rewires everything through the drive, which reconnects a and c and hides
    // `b` entirely.
    await seedNotes("a", "b", "c");
    await seedEdge("a", "b", "RELATES_TO");
    await seedEdge("b", "c", "RELATES_TO");
    for (const id of ["a", "b", "c"]) await seedEdge(DRIVE, id, "child");

    const bridges = await query.bridges();
    expect(bridges.map((n) => n.documentId)).toEqual(["b"]);
  });

  it("triangles() still finds the synthesis opportunity", async () => {
    // a→c and b→c with no a—b link is the classic "these two belong together"
    // signal; containment adds the drive as a third co-source of c.
    await seedNotes("a", "b", "c");
    await seedEdge("a", "c", "RELATES_TO");
    await seedEdge("b", "c", "RELATES_TO");
    for (const id of ["a", "b", "c"]) await seedEdge(DRIVE, id, "child");

    const triangles = await query.triangles(10);
    expect(triangles).toHaveLength(1);
    expect(triangles[0].sharedTarget.documentId).toBe("c");
    expect([triangles[0].a.documentId, triangles[0].b.documentId].sort()).toEqual(
      ["a", "b"],
    );
  });
});

describe("pruneNonKnowledgeEdges()", () => {
  it("deletes containment and untyped rows, keeps every knowledge type", async () => {
    await seedNotes("a", "b");
    for (const t of KNOWLEDGE_LINK_TYPES) await seedEdge("a", "b", t);
    await seedEdge(DRIVE, "a", "child");
    await seedEdge(DRIVE, "b", "child");
    await seedEdge("a", "b", null);
    await seedEdge("a", "b", "contains");

    const removed = await pruneNonKnowledgeEdges(db);
    expect(removed).toBe(4); // 2 child + 1 null + 1 unknown

    const byName = (a: string, b: string) => a.localeCompare(b);
    const remaining = await db.selectFrom("graph_edges").selectAll().execute();
    expect(
      remaining.map((r) => r.link_type as string).sort(byName),
    ).toEqual([...KNOWLEDGE_LINK_TYPES].sort(byName));
  });

  it("is a no-op on an already-clean projection", async () => {
    await seedNotes("a", "b");
    await seedEdge("a", "b", "RELATES_TO");

    expect(await pruneNonKnowledgeEdges(db)).toBe(0);
    expect(await db.selectFrom("graph_edges").selectAll().execute()).toHaveLength(
      1,
    );
  });
});
