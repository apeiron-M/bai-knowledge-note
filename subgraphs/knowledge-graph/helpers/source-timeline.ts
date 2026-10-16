/**
 * Loads a drive's source timeline on the server: the drive tree from the
 * reactor, each source's small row from the index (`graph_sources`, kept by
 * the graph indexer), the notes, topics and links from the index, then the
 * shared builder. Sources the index has no row for yet — a vault indexed
 * before the table existed — are read from the reactor once and their rows
 * saved, so the next load reads one table rather than every source in full.
 * Serves `knowledgeGraphSourceTimeline` and `GET timeline`.
 */
import {
  buildSourceTimeline,
  findSourcesRoot,
  revisionOf,
  SOURCE_ROW_VERSION,
  sourceRowOf,
  type SourceTimeline,
  type TimelineFolder,
  type TimelineSource,
  type TimelineSourceRow,
} from "../../../processors/graph-indexer/source-timeline.js";
import type { Kysely } from "kysely";
import type { GraphEdgeResult, TimelineNodeRow } from "../../../processors/graph-indexer/query.js";
import type { DB } from "../../../processors/graph-indexer/schema.js";

/** As much of the reactor client as the timeline reads. */
export interface TimelineReader {
  get(id: string): Promise<unknown>;
  find(
    search: { ids: string[] },
    view?: undefined,
    paging?: { cursor: string; limit: number },
  ): Promise<{ results: unknown[]; nextCursor?: string }>;
}

/** As much of the graph query as the timeline reads. */
export interface TimelineGraph {
  timelineNodes(): Promise<TimelineNodeRow[]>;
  allEdges(): Promise<GraphEdgeResult[]>;
  topicsByDocument(): Promise<Map<string, string[]>>;
  timelineSources(): Promise<Map<string, TimelineSourceRow>>;
}

/** A source row read from its document, with the revision it was read at. */
export interface KeptSource {
  row: TimelineSourceRow;
  revision: number;
  /** The document's last modification, for the row's `updated_at`. */
  modifiedAt: string;
}

/**
 * Where rows read from documents are kept for next time. It never replaces
 * a current row: the indexer's row is at least as new as any read here.
 */
export interface TimelineSourceStore {
  save(rows: readonly KeptSource[]): Promise<void>;
}

interface DriveNode {
  id: string;
  name?: string | null;
  kind?: string;
  documentType?: string | null;
  parentFolder?: string | null;
}

const PAGE = 250;

/** Rows per statement: a few columns each, far under Postgres's 65,535 parameters. */
const WRITE_CHUNK = 1_000;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Read documents by id, a page of ids at a time (so no request carries every id), following the reactor's cursor. */
async function readAll(reader: TimelineReader, ids: readonly string[], pageSize: number): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const batch of chunks(ids, pageSize)) {
    let cursor = "0";
    for (;;) {
      const page = await reader.find({ ids: batch }, undefined, { cursor, limit: pageSize });
      out.push(...page.results);
      if (!page.nextCursor || page.nextCursor === cursor) break;
      cursor = page.nextCursor;
    }
  }
  return out;
}

/** Sources read from documents, as rows the index can keep. */
function keptFrom(docs: readonly unknown[], wanted: (id: string) => boolean): KeptSource[] {
  const out: KeptSource[] = [];
  for (const doc of docs) {
    const row = sourceRowOf(doc);
    if (!row || !wanted(row.id)) continue;
    const modified = (doc as { header?: { lastModifiedAtUtcIso?: unknown } }).header?.lastModifiedAtUtcIso;
    out.push({ row, revision: revisionOf(doc), modifiedAt: typeof modified === "string" ? modified : row.addedAt });
  }
  return out;
}

export async function loadSourceTimeline(
  reader: TimelineReader,
  graph: TimelineGraph,
  driveId: string,
  opts: { pageSize?: number; store?: TimelineSourceStore } = {},
): Promise<SourceTimeline> {
  const drive = (await reader.get(driveId)) as { state?: { global?: { nodes?: DriveNode[] } } } | null;
  const tree = drive?.state?.global?.nodes ?? [];
  const folders: TimelineFolder[] = tree
    .filter((n) => n.kind === "folder")
    .map((n) => ({ id: n.id, name: n.name ?? "", parentFolder: n.parentFolder ?? null }));
  const root = findSourcesRoot(folders);
  const placed = new Map(tree.filter((n) => n.documentType === "bai/source").map((n) => [n.id, n.parentFolder ?? null]));

  const [kept, nodes, edges, topics] = await Promise.all([
    // An index that cannot list rows (a namespace older than the table) means reading every source.
    placed.size > 0 ? graph.timelineSources().catch(() => new Map<string, TimelineSourceRow>()) : Promise.resolve(new Map<string, TimelineSourceRow>()),
    graph.timelineNodes(),
    graph.allEdges(),
    graph.topicsByDocument(),
  ]);
  const missing = [...placed.keys()].filter((id) => !kept.has(id));
  const read = missing.length > 0 ? keptFrom(await readAll(reader, missing, opts.pageSize ?? PAGE), (id) => placed.has(id)) : [];
  if (missing.length > 0) console.log(`[sourceTimeline] ${driveId}: read ${missing.length} source(s) the index had no row for`);
  if (read.length > 0 && opts.store) {
    // Best effort: a failed save costs the next load a read, never this answer.
    await opts.store.save(read).catch((err: unknown) => console.warn("[sourceTimeline] could not keep source rows:", err instanceof Error ? err.message : err));
  }
  const rows = new Map(kept);
  for (const { row } of read) rows.set(row.id, row);
  const sources: TimelineSource[] = [];
  for (const [id, parentFolder] of placed) {
    const row = rows.get(id);
    if (row) sources.push({ ...row, parentFolder });
  }

  return buildSourceTimeline({
    sourcesFolderId: root,
    folders,
    sources,
    nodes: nodes.map((n) => ({
      documentId: n.documentId,
      documentType: n.documentType ?? "bai/knowledge-note",
      title: n.title ?? "",
      status: n.status,
      noteType: n.noteType,
      topics: topics.get(n.documentId) ?? [],
      addedAt: n.addedAt,
      createdAt: n.createdAt,
      sourceOrigin: n.sourceOrigin,
    })),
    edges: edges.map((e) => ({ source: e.sourceDocumentId, target: e.targetDocumentId, type: e.linkType ?? "" })),
  });
}

/** Rows kept in the drive's index namespace; `db` opens it for writing only when there is something to keep. */
export function sourceRowStore(db: () => Promise<Kysely<DB>>): TimelineSourceStore {
  return {
    async save(rows) {
      if (rows.length === 0) return;
      const writable = await db();
      for (const batch of chunks(rows, WRITE_CHUNK)) {
        await writable
          .insertInto("graph_sources")
          .values(batch.map(({ row, revision, modifiedAt }) => ({ document_id: row.id, row_json: JSON.stringify(row), revision, version: SOURCE_ROW_VERSION, updated_at: modifiedAt })))
          // A current row is the indexer's, written from the source's own
          // latest operation: keep it. Only a row of an older shape is replaced.
          .onConflict((oc) =>
            oc
              .column("document_id")
              .doUpdateSet((eb) => ({ row_json: eb.ref("excluded.row_json"), revision: eb.ref("excluded.revision"), version: eb.ref("excluded.version"), updated_at: eb.ref("excluded.updated_at") }))
              .where("graph_sources.version", "<", SOURCE_ROW_VERSION),
          )
          .execute();
      }
    },
  };
}

/**
 * A reindex: every source's row from its document, and no row for a source
 * the drive no longer holds. A row the indexer wrote at a higher revision
 * while this was reading is kept. Returns the rows read.
 */
export async function rebuildSourceRows(db: Kysely<DB>, reader: TimelineReader, sourceIds: readonly string[], pageSize = PAGE): Promise<number> {
  const ids = new Set(sourceIds);
  const existing = await db.selectFrom("graph_sources").select("document_id").execute();
  const gone = existing.map((r) => r.document_id).filter((id) => !ids.has(id));
  for (const batch of chunks(gone, WRITE_CHUNK)) await db.deleteFrom("graph_sources").where("document_id", "in", batch).execute();
  if (ids.size === 0) return 0;
  const rows = keptFrom(await readAll(reader, [...ids], pageSize), (id) => ids.has(id));
  for (const { row, revision, modifiedAt } of rows) {
    const values = { row_json: JSON.stringify(row), revision, version: SOURCE_ROW_VERSION, updated_at: modifiedAt };
    await db
      .insertInto("graph_sources")
      .values({ document_id: row.id, ...values })
      .onConflict((oc) =>
        oc
          .column("document_id")
          .doUpdateSet(values)
          .where((eb) =>
            eb.or([
              eb("graph_sources.revision", "<=", eb.ref("excluded.revision")),
              eb("excluded.revision", "<", 0),
              eb("graph_sources.version", "<", SOURCE_ROW_VERSION),
            ]),
          ),
      )
      .execute();
  }
  return rows.length;
}
