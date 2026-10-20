import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../tests/helpers/create-test-db.js";
import { createGraphQuery } from "../../../processors/graph-indexer/query.js";
import { SOURCE_ROW_VERSION, sourceRowOf } from "../../../processors/graph-indexer/source-timeline.js";
import { loadPlacedSources, loadSourceTimeline, rebuildSourceRows, sourceListRow, sourceRowStore, type TimelineReader, type TimelineSourceStore } from "./source-timeline.js";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const DRIVE = "drive-1";
const nodes = [
  { id: "f-sources", name: "sources", kind: "folder", parentFolder: null },
  { id: "f-book", name: "Machine-Learning-Systems-Vol1", kind: "folder", parentFolder: "f-sources" },
  { id: "s1", name: "Chapter 1", kind: "file", documentType: "bai/source", parentFolder: "f-book" },
  { id: "s2", name: "Chapter 2", kind: "file", documentType: "bai/source", parentFolder: "f-book" },
  { id: "s3", name: "Chapter 3", kind: "file", documentType: "bai/source", parentFolder: "f-book" },
  { id: "pasted", name: "Pasted", kind: "file", documentType: "bai/source", parentFolder: "f-sources" },
  { id: "gone", name: "Deleted since", kind: "file", documentType: "bai/source", parentFolder: "f-sources" },
  { id: "n1", name: "note", kind: "file", documentType: "bai/knowledge-note", parentFolder: null },
];

function sourceDoc(id: string, createdAtUtcIso: string, over: Record<string, unknown> = {}) {
  return {
    header: { id, name: id, createdAtUtcIso, documentType: "bai/source" },
    state: {
      global: {
        title: `Title ${id}`,
        status: "EXTRACTED",
        createdAt: createdAtUtcIso,
        createdBy: "did:key:me",
        sourceType: "ARTICLE",
        provenance: { method: "converted", tool: "docling.rs", url: null },
        originalFileName: "Machine-Learning-Systems-Vol1.pdf",
        originalMimeType: "application/pdf",
        originalSizeBytes: 12_197_035,
        extractedClaims: [],
        ...over,
      },
    },
  };
}

const docs = new Map<string, unknown>([
  ["s1", sourceDoc("s1", "2026-10-15T19:04:00.000Z", { extractedClaims: [{ claimRef: "n-claimed" }] })],
  ["s2", sourceDoc("s2", "2026-10-15T19:05:00.000Z", { status: "EXTRACTING" })],
  ["s3", sourceDoc("s3", "2026-10-15T19:06:00.000Z", { status: "INBOX" })],
  ["pasted", sourceDoc("pasted", "2026-10-10T19:20:00.000Z", { title: "How Knowledge Vault works", originalFileName: null, originalMimeType: null, originalSizeBytes: null, provenance: null })],
  ["other-drive", sourceDoc("other-drive", "2026-10-11T00:00:00.000Z")],
]);

function reader(tree = nodes) {
  const find = vi.fn((search: { ids: string[] }, _view?: undefined, paging?: { cursor: string; limit: number }) => {
    const start = Number(paging?.cursor ?? 0) || 0;
    const limit = paging?.limit ?? search.ids.length;
    const ids = search.ids.slice(start, start + limit);
    return Promise.resolve({
      results: ids.map((id) => docs.get(id)).filter(Boolean),
      nextCursor: start + limit < search.ids.length ? String(start + limit) : undefined,
    });
  });
  const r: TimelineReader = {
    get: vi.fn((id: string) =>
      id === DRIVE ? Promise.resolve({ header: { id: DRIVE }, state: { global: { nodes: tree } } }) : Promise.reject(new Error(`unexpected get ${id}`)),
    ),
    find,
  };
  return { r, find };
}

describe("loadSourceTimeline", () => {
  let harness: TestDb;

  beforeEach(async () => {
    harness = await createTestDb();
    const note = (id: string, addedAt: string | null, createdAt: string) => ({
      id, document_id: id, title: `Note ${id}`, description: null, note_type: "concept", status: "IN_REVIEW",
      source_origin: "DERIVED", created_at: createdAt, added_at: addedAt, updated_at: createdAt, document_type: "bai/knowledge-note",
    });
    await harness.db.insertInto("graph_nodes").values([
      note("n1", "2026-10-15T19:06:30.000Z", "2026-10-15T19:06:30.000Z"),
      note("n-claimed", null, "2026-10-15T19:07:00.000Z"),
      { ...note("m1", "2026-10-15T19:30:00.000Z", "2026-10-15T19:30:00.000Z"), status: "MOC", note_type: "MOC (TOPIC)", document_type: "bai/moc", title: "ML Systems Reasoning" },
    ]).execute();
    const edge = (s: string, t: string, type: string) => ({ id: `${s}-${t}-${type}`, source_document_id: s, target_document_id: t, link_type: type, target_title: null, updated_at: "2026-10-15T20:00:00.000Z" });
    await harness.db.insertInto("graph_edges").values([
      edge("n1", "s1", "DERIVED_FROM"),
      edge("m1", "n1", "CORE_IDEA"),
      edge("m1", "n-claimed", "CORE_IDEA"),
      edge("n1", "n-claimed", "BUILDS_ON"),
    ]).execute();
    await harness.db.insertInto("graph_topics").values([
      { id: "t1", document_id: "n1", name: "ML systems", updated_at: "2026-10-15T20:00:00.000Z" },
      { id: "t2", document_id: "n-claimed", name: "ML systems", updated_at: "2026-10-15T20:00:00.000Z" },
      { id: "t3", document_id: "n-claimed", name: "Safety", updated_at: "2026-10-15T20:00:00.000Z" },
    ]).execute();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it("reads the drive's sources a page at a time and joins them with the index", async () => {
    const { r, find } = reader();
    const t = await loadSourceTimeline(r, createGraphQuery(harness.db), DRIVE, { pageSize: 2 });
    // five source ids in the drive, two per page: three reads, ids only from this drive
    expect(find).toHaveBeenCalledTimes(3);
    expect(find.mock.calls.flatMap(([s]) => s.ids)).toEqual(["s1", "s2", "s3", "pasted", "gone"]);

    expect(t.additions.map((a) => [a.kind, a.title, a.sources, a.waiting, a.notes])).toEqual([
      ["text", "How Knowledge Vault works", 1, 0, 0],
      ["file", "Machine-Learning-Systems-Vol1", 3, 2, 2],
    ]);
    const book = t.additions[1];
    expect(book).toMatchObject({ fileName: "Machine-Learning-Systems-Vol1.pdf", sizeBytes: 12_197_035, linksWithin: 1, topicIds: ["m1"] });
    expect(book.tags).toEqual([
      { name: "ML systems", count: 2 },
      { name: "Safety", count: 1 },
    ]);
    expect(t.notes.find((n) => n.documentId === "n1")).toMatchObject({ addedAt: "2026-10-15T19:06:30.000Z", additionId: book.id });
    // a note the index has no arrival time for falls back to its written date
    expect(t.notes.find((n) => n.documentId === "n-claimed")).toMatchObject({ addedAt: "2026-10-15T19:07:00.000Z", additionId: book.id });
    expect(t.topics).toEqual([{ documentId: "m1", title: "ML Systems Reasoning", addedAt: "2026-10-15T19:30:00.000Z", writtenAt: "2026-10-15T19:30:00.000Z", additionId: book.id }]);
    expect(t.totals).toEqual({ sources: 4, notes: 2, topics: 1, links: 1 });
  });

  it("uses the index's rows for the sources it has, and reads only the rest — saving them for next time", async () => {
    const graph = createGraphQuery(harness.db);
    const s1 = sourceRowOf(docs.get("s1"));
    const s2 = sourceRowOf(docs.get("s2"));
    await harness.db
      .insertInto("graph_sources")
      .values([s1, s2].map((row) => ({ document_id: row!.id, row_json: JSON.stringify(row), updated_at: row!.addedAt, version: SOURCE_ROW_VERSION })))
      .execute();
    const saved: string[] = [];
    const store: TimelineSourceStore = { save: (rows) => Promise.resolve(void saved.push(...rows.map((r) => r.row.id))) };
    const { r, find } = reader();
    const t = await loadSourceTimeline(r, graph, DRIVE, { store });
    expect(find.mock.calls.flatMap(([q]) => q.ids)).toEqual(["s3", "pasted", "gone"]);
    expect(saved).toEqual(["s3", "pasted"]);
    expect(t.additions.find((a) => a.title === "Machine-Learning-Systems-Vol1")).toMatchObject({ sources: 3, waiting: 2 });
  });

  it("asks the reactor for sources a page of ids at a time", async () => {
    const { r, find } = reader();
    await loadSourceTimeline(r, createGraphQuery(harness.db), DRIVE, { pageSize: 2 });
    expect(find.mock.calls.map(([q]) => q.ids)).toEqual([["s1", "s2"], ["s3", "pasted"], ["gone"]]);
  });

  it("reads every source when the index holds no rows, and still answers when saving fails", async () => {
    const { r, find } = reader();
    const store: TimelineSourceStore = { save: () => Promise.reject(new Error("read-only")) };
    const t = await loadSourceTimeline(r, createGraphQuery(harness.db), DRIVE, { store });
    expect(find.mock.calls.flatMap(([q]) => q.ids)).toEqual(["s1", "s2", "s3", "pasted", "gone"]);
    expect(t.totals.sources).toBe(4);
  });

  it("falls back to reading documents when the index cannot list source rows", async () => {
    const graph = createGraphQuery(harness.db);
    const broken = { ...graph, timelineSources: () => Promise.reject(new Error('relation "graph_sources" does not exist')) };
    const { r, find } = reader();
    const t = await loadSourceTimeline(r, broken, DRIVE);
    expect(find).toHaveBeenCalled();
    expect(t.totals.sources).toBe(4);
  });

  it("finds /sources by the vault's own rule, so a capitalised folder is an ordinary folder", async () => {
    const { r } = reader(nodes.map((n) => (n.id === "f-sources" ? { ...n, name: "Sources" } : n)));
    const t = await loadSourceTimeline(r, createGraphQuery(harness.db), DRIVE);
    expect(t.additions[0]).toMatchObject({ title: "Sources", folderId: "f-sources", sources: 1 });
  });

  it("returns an empty timeline for a drive with no sources and no notes", async () => {
    const find = vi.fn(() => Promise.resolve({ results: [] }));
    const empty: TimelineReader = {
      get: () => Promise.resolve({ header: { id: DRIVE }, state: { global: { nodes: [] } } }),
      find,
    };
    const fresh = await createTestDb();
    try {
      const t = await loadSourceTimeline(empty, createGraphQuery(fresh.db), DRIVE);
      expect(t).toEqual({ additions: [], notes: [], topics: [], totals: { sources: 0, notes: 0, topics: 0, links: 0 } });
      expect(find).not.toHaveBeenCalled();
    } finally {
      await fresh.cleanup();
    }
  });
});

describe("rebuildSourceRows (reindex)", () => {
  let harness: TestDb;
  beforeEach(async () => {
    harness = await createTestDb();
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  it("rewrites every source's row from its document and drops rows for sources the drive no longer holds", async () => {
    const stale = { ...sourceRowOf(docs.get("s2"))!, status: "INBOX" };
    await harness.db
      .insertInto("graph_sources")
      .values([
        { document_id: "s2", row_json: JSON.stringify(stale), updated_at: "2026-10-15T19:05:00.000Z", version: SOURCE_ROW_VERSION },
        { document_id: "removed", row_json: JSON.stringify({ ...stale, id: "removed" }), updated_at: "2026-10-15T19:05:00.000Z", version: SOURCE_ROW_VERSION },
      ])
      .execute();
    const { r } = reader();
    const written = await rebuildSourceRows(harness.db, r, ["s1", "s2", "pasted"]);
    expect(written).toBe(3);
    const rows = await createGraphQuery(harness.db).timelineSources();
    expect([...rows.keys()].sort()).toEqual(["pasted", "s1", "s2"]);
    expect(rows.get("s2")?.status).toBe("EXTRACTING");
  });

  it("empties the table for a drive with no sources", async () => {
    await harness.db.insertInto("graph_sources").values({ document_id: "x", row_json: "{}", updated_at: "2026-10-15T19:05:00.000Z", version: SOURCE_ROW_VERSION }).execute();
    const { r, find } = reader();
    expect(await rebuildSourceRows(harness.db, r, [])).toBe(0);
    expect(find).not.toHaveBeenCalled();
    expect((await createGraphQuery(harness.db).timelineSources()).size).toBe(0);
  });
});

describe("sourceRowStore", () => {
  let harness: TestDb;
  beforeEach(async () => {
    harness = await createTestDb();
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  it("saves thousands of rows in chunks, and replaces only a row of an older shape", async () => {
    const base = sourceRowOf(docs.get("s1"))!;
    await harness.db.insertInto("graph_sources").values([
      { document_id: "x0", row_json: JSON.stringify({ ...base, id: "x0", status: "FROM-INDEXER" }), updated_at: "2026-10-15T20:00:00.000Z", version: SOURCE_ROW_VERSION },
      { document_id: "x1", row_json: JSON.stringify({ id: "x1" }), updated_at: "2026-10-15T20:00:00.000Z", version: 0 },
    ]).execute();
    const rows = Array.from({ length: 2500 }, (_, i) => ({ row: { ...base, id: `x${i}`, status: "FROM-READ" }, revision: 1, modifiedAt: "2026-10-15T19:00:00.000Z" }));
    await sourceRowStore(() => Promise.resolve(harness.db)).save(rows);
    const kept = await createGraphQuery(harness.db).timelineSources();
    expect(kept.size).toBe(2500);
    expect(kept.get("x0")?.status).toBe("FROM-INDEXER");
    expect(kept.get("x1")?.status).toBe("FROM-READ");
  });
});

describe("rebuildSourceRows, racing the indexer", () => {
  let harness: TestDb;
  beforeEach(async () => {
    harness = await createTestDb();
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  it("does not write a read older than the indexer's row", async () => {
    const newer = { ...sourceRowOf(docs.get("s2"))!, status: "EXTRACTED" };
    await harness.db.insertInto("graph_sources").values({ document_id: "s2", row_json: JSON.stringify(newer), updated_at: "2026-10-15T21:00:00.000Z", version: SOURCE_ROW_VERSION, revision: 9 }).execute();
    const original = docs.get("s2") as { header: Record<string, unknown> };
    const stale = { ...original, header: { ...original.header, lastModifiedAtUtcIso: "2026-10-15T19:05:00.000Z", revision: { global: 3 } } };
    const r: TimelineReader = { get: () => Promise.reject(new Error("unused")), find: () => Promise.resolve({ results: [stale] }) };
    await rebuildSourceRows(harness.db, r, ["s2"]);
    expect((await createGraphQuery(harness.db).timelineSources()).get("s2")?.status).toBe("EXTRACTED");
  });
});

describe("the Sources list rows (knowledgeGraphSources)", () => {
  let harness: TestDb;
  beforeEach(async () => {
    harness = await createTestDb();
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  it("answers every source from the index's rows, reading only those it has no current row for", async () => {
    const s1 = sourceRowOf({ ...(docs.get("s1") as object), header: { id: "s1", name: "Chapter 1", createdAtUtcIso: "2026-10-15T19:04:00.000Z", lastModifiedAtUtcIso: "2026-10-15T19:10:00.000Z" } })!;
    await harness.db
      .insertInto("graph_sources")
      .values([
        { document_id: "s1", row_json: JSON.stringify({ ...s1, description: "From the index" }), updated_at: s1.addedAt, version: SOURCE_ROW_VERSION },
        // an older row shape is read again
        { document_id: "s2", row_json: JSON.stringify(sourceRowOf(docs.get("s2"))), updated_at: s1.addedAt, version: SOURCE_ROW_VERSION - 1 },
      ])
      .execute();
    const { r, find } = reader();
    const { sources } = await loadPlacedSources(r, createGraphQuery(harness.db), DRIVE);
    expect(find.mock.calls.flatMap(([q]) => q.ids)).toEqual(["s2", "s3", "pasted", "gone"]);

    const rows = sources.map(sourceListRow);
    expect(rows.map((x) => x.documentId)).toEqual(["s1", "s2", "s3", "pasted"]);
    expect(rows[0]).toMatchObject({
      parentFolder: "f-book",
      name: "Chapter 1",
      title: "Title s1",
      description: "From the index",
      status: "EXTRACTED",
      claimCount: 1,
      updatedAt: "2026-10-15T19:10:00.000Z",
      originalFileName: "Machine-Learning-Systems-Vol1.pdf",
      originalSizeBytes: 12_197_035,
    });
    expect(rows[1]).toMatchObject({ status: "EXTRACTING", parentFolder: "f-book" });
  });
});
