/**
 * Archived notes are history, not current knowledge. They stay indexed —
 * backlinks, SUPERSEDES chains and the operation log are how a reader learns
 * WHY the vault stopped holding a claim — but discovery skips them unless the
 * caller asks for archaeology with `includeArchived`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { up, down } from "../../processors/graph-indexer/migrations.js";
import { createGraphQuery, isCurrentNode } from "../../processors/graph-indexer/query.js";

let db: Kysely<DB>;
let query: ReturnType<typeof createGraphQuery>;
const T = "2026-09-02T10:00:00.000Z";

beforeAll(async () => {
  const pglite = new PGlite();
  db = new Kysely<DB>({ dialect: new PGliteDialect(pglite) });
  await up(db as unknown as IRelationalDb<DB>);
  query = createGraphQuery(db);
  const rows = [
    ["cur", "CANONICAL", "Reactor authorization uses a layered model", "policies at boot"],
    ["old", "ARCHIVED", "Reactor authorization uses six database tables", "superseded: the group tables were dropped"],
    ["moc", "MOC", "Authorization and Identity", "map"],
    ["nul", null, "Authorization draft with no status yet", "legacy row"],
  ] as const;
  for (const [id, status, title, description] of rows) {
    await db.insertInto("graph_nodes").values({
      id, document_id: id, title, description, note_type: null, status, updated_at: T,
      document_type: status === "MOC" ? "bai/moc" : "bai/knowledge-note", content: `${title}. ${description}`,
    }).execute();
    await db.insertInto("graph_topics").values({ id: `${id}-t`, document_id: id, name: "authorization", updated_at: T }).execute();
  }
});

afterAll(async () => {
  await down(db as unknown as IRelationalDb<DB>);
  await db.destroy();
});

const ids = (rows: { documentId: string }[]) => rows.map((r) => r.documentId).sort();

describe("archived notes and discovery", () => {
  it("isCurrentNode treats only ARCHIVED as not current", () => {
    expect(isCurrentNode({ status: "CANONICAL" })).toBe(true);
    expect(isCurrentNode({ status: null })).toBe(true);
    expect(isCurrentNode({ status: "ARCHIVED" })).toBe(false);
    expect(isCurrentNode(null)).toBe(false);
  });

  it("keyword search hides archived notes by default and shows them on request", async () => {
    expect(ids(await query.searchNodes("authorization"))).toEqual(["cur", "moc", "nul"]);
    expect(ids(await query.searchNodes("authorization", 50, { includeArchived: true }))).toEqual(["cur", "moc", "nul", "old"]);
    expect(ids(await query.fullSearch("database tables"))).toEqual([]);
    expect(ids(await query.fullSearch("database tables", 50, { includeArchived: true }))).toEqual(["old"]);
  });

  it("topic browsing and topic neighbours skip archived notes unless asked", async () => {
    expect(ids(await query.nodesByTopic("authorization"))).toEqual(["cur", "moc", "nul"]);
    expect(ids(await query.nodesByTopic("authorization", { includeArchived: true }))).toContain("old");
    const related = await query.relatedByTopic("cur", 10);
    expect(related.map((r) => r.node.documentId).sort()).toEqual(["moc", "nul"]);
    const all = await query.relatedByTopic("cur", 10, { includeArchived: true });
    expect(all.map((r) => r.node.documentId).sort()).toEqual(["moc", "nul", "old"]);
  });

  it("hybrid search drops an archived semantic hit that the keyword leg never saw", async () => {
    const semantic = [{ documentId: "old", similarity: 0.99 }, { documentId: "cur", similarity: 0.5 }];
    const hits = await query.hybridSearch("nothing-matches-by-keyword", semantic, 10);
    expect(hits.map((h) => h.node.documentId)).toEqual(["cur"]);
    const archaeology = await query.hybridSearch("nothing-matches-by-keyword", semantic, 10, { includeArchived: true });
    expect(archaeology.map((h) => h.node.documentId)).toEqual(["old", "cur"]);
  });

  it("structural reads are untouched: the archived note is still a node with a title", async () => {
    expect((await query.nodeByDocumentId("old"))?.title).toContain("six database tables");
    expect(ids(await query.nodesByStatus("ARCHIVED"))).toEqual(["old"]);
  });
});
