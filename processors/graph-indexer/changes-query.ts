/**
 * The query half of the change digest: reads a window of `graph_operations`
 * and the graph context it needs, and hands both to the pure `buildChanges`.
 *
 * Size: a window can hold tens of thousands of operations (the 2026-11-03
 * sync wrote 13,329 in hours), almost all metadata stamps and link writes.
 * Every row is read for counting, but `input_json` only for the operations
 * that can become an event (a SUPERSEDES link, a version stamp, a claim
 * edit, a lifecycle step, an ingestion) — the rest come back without it.
 */
import { sql, type Kysely } from "kysely";
import type { DB } from "./schema.js";
import {
  BASELINE_OPERATION_TYPES,
  buildChanges,
  EVENT_OPERATION_TYPES,
  type ChangeContext,
  type ChangeDigest,
  type ChangeScope,
  type MocTier,
  type OperationRow,
} from "./changes.js";
import { parseEdgeMetadata } from "./edge-metadata.js";
import { SOURCE_ROW_VERSION, type TimelineSourceRow } from "./source-timeline.js";

type ReadDb = Pick<Kysely<DB>, "selectFrom">;

const SOURCE_TYPE = "bai/source";
/** Bound parameter lists stay well under Postgres's 65,535. */
const CHUNK = 1000;

/** Operation types whose input is always needed; the two below need theirs only sometimes. */
const PLAIN_EVENT_TYPES = EVENT_OPERATION_TYPES.filter((t) => t !== "ADD_RELATIONSHIP" && t !== "SET_METADATA_FIELD");
const SUPERSEDES_LIKE = '%"relationshipType":"SUPERSEDES"%';
const VERSION_LIKE = '%"field":"version"%';

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

type RawRow = {
  id: string;
  document_id: string;
  document_type: string | null;
  operation_type: string;
  timestamp: string;
  index: number;
  input_json: string | null;
  signer_address: string | null;
};

function toRow(r: RawRow): OperationRow {
  return {
    documentId: r.document_id,
    // Untyped legacy rows are node rows (the migration types sources).
    documentType: r.document_type ?? "bai/knowledge-note",
    operationType: r.operation_type,
    timestamp: r.timestamp,
    index: r.index,
    inputJson: r.input_json,
    signerAddress: r.signer_address,
  };
}

async function sourceRows(db: ReadDb, ids?: string[]): Promise<Map<string, TimelineSourceRow>> {
  const out = new Map<string, TimelineSourceRow>();
  const read = async (where?: string[]) => {
    let q = db.selectFrom("graph_sources").select(["document_id", "row_json", "version"]);
    if (where) q = q.where("document_id", "in", where);
    for (const r of await q.execute()) {
      if (r.version !== SOURCE_ROW_VERSION) continue;
      try {
        out.set(r.document_id, JSON.parse(r.row_json) as TimelineSourceRow);
      } catch {
        // an unreadable row has no claims to group by
      }
    }
  };
  if (!ids) await read();
  else for (const part of chunks(ids)) await read(part);
  return out;
}

async function edgeTargets(db: ReadDb, sources: string[], type: string): Promise<{ source: string; target: string }[]> {
  const out: { source: string; target: string }[] = [];
  for (const part of chunks(sources)) {
    const rows = await db
      .selectFrom("graph_edges")
      .select(["source_document_id", "target_document_id"])
      .where("source_document_id", "in", part)
      .where("link_type", "=", type)
      .execute();
    for (const r of rows) out.push({ source: r.source_document_id, target: r.target_document_id });
  }
  return out;
}

/** The notes a set resolves to, plus the sources they come from (DERIVED_FROM, or a source's claim list). */
async function withSources(db: ReadDb, notes: Set<string>): Promise<Set<string>> {
  const ids = new Set(notes);
  const sources = await sourceRows(db);
  for (const e of await edgeTargets(db, [...notes], "DERIVED_FROM")) if (sources.has(e.target)) ids.add(e.target);
  for (const [id, row] of sources) if ((row.claimIds ?? []).some((n) => notes.has(n))) ids.add(id);
  return ids;
}

/** A map's scope: itself, its child maps (recursively), their CORE_IDEA notes, and those notes' sources. */
async function mocScope(db: ReadDb, mocId: string): Promise<Set<string>> {
  const mocs = new Set([mocId]);
  let frontier = [mocId];
  while (frontier.length) {
    const next: string[] = [];
    for (const e of await edgeTargets(db, frontier, "CHILD_MOC")) {
      if (mocs.has(e.target)) continue;
      mocs.add(e.target);
      next.push(e.target);
    }
    frontier = next;
  }
  const notes = new Set(mocs);
  for (const e of await edgeTargets(db, [...mocs], "CORE_IDEA")) notes.add(e.target);
  return withSources(db, notes);
}

async function topicScope(db: ReadDb, topic: string): Promise<Set<string>> {
  const rows = await db.selectFrom("graph_topics").select("document_id").where("name", "=", topic).execute();
  return withSources(db, new Set(rows.map((r) => r.document_id)));
}

function intersect(a: Set<string> | null, b: Set<string>): Set<string> {
  return a ? new Set([...a].filter((x) => b.has(x))) : b;
}

async function windowRows(db: ReadDb, window: { since: string; until: string }, ids: string[] | null): Promise<RawRow[]> {
  const base = () =>
    db
      .selectFrom("graph_operations")
      .select([
        "id",
        "document_id",
        "document_type",
        "operation_type",
        "timestamp",
        "index",
        "signer_address",
        sql<string | null>`case
          when operation_type in (${sql.join(PLAIN_EVENT_TYPES)}) then input_json
          when operation_type = 'ADD_RELATIONSHIP' and input_json like ${SUPERSEDES_LIKE} then input_json
          when operation_type = 'SET_METADATA_FIELD' and input_json like ${VERSION_LIKE} then input_json
          else null end`.as("input_json"),
      ])
      .where("timestamp", ">=", window.since)
      .where("timestamp", "<=", window.until);
  if (!ids) return (await base().execute()) as RawRow[];
  const out: RawRow[] = [];
  for (const part of chunks(ids)) out.push(...((await base().where("document_id", "in", part).execute()) as RawRow[]));
  // A supersession is recorded on the replacing note, which may be outside the scope.
  const seen = new Set(out.map((r) => r.id));
  const sup = (await base()
    .where("operation_type", "=", "ADD_RELATIONSHIP")
    .where("input_json", "like", SUPERSEDES_LIKE)
    .execute()) as RawRow[];
  for (const r of sup) if (!seen.has(r.id)) out.push(r);
  return out;
}

/** The last pre-window row per document and tracked operation type, plus every pre-window content patch. */
async function baselineRows(db: ReadDb, since: string, docIds: string[]): Promise<RawRow[]> {
  const tracked = BASELINE_OPERATION_TYPES.filter((t) => t !== "PATCH_CONTENT");
  const out: RawRow[] = [];
  for (const part of chunks(docIds)) {
    const ranked = db
      .selectFrom("graph_operations")
      .select([
        "id",
        "document_id",
        "document_type",
        "operation_type",
        "timestamp",
        "index",
        "input_json",
        "signer_address",
        sql<number>`row_number() over (partition by document_id, operation_type order by timestamp desc, "index" desc)`.as("rn"),
      ])
      .where("timestamp", "<", since)
      .where("document_id", "in", part)
      .where("operation_type", "in", tracked)
      .where((eb) => eb.or([eb("operation_type", "!=", "SET_METADATA_FIELD"), eb("input_json", "like", VERSION_LIKE)]));
    const last = await db
      .selectFrom(ranked.as("ranked"))
      .select(["id", "document_id", "document_type", "operation_type", "timestamp", "index", "input_json", "signer_address"])
      .where("rn", "=", 1)
      .execute();
    out.push(...(last as RawRow[]));
    const patches = await db
      .selectFrom("graph_operations")
      .select(["id", "document_id", "document_type", "operation_type", "timestamp", "index", "input_json", "signer_address"])
      .where("timestamp", "<", since)
      .where("document_id", "in", part)
      .where("operation_type", "=", "PATCH_CONTENT")
      .execute();
    out.push(...(patches as RawRow[]));
  }
  return out;
}

async function loadContext(db: ReadDb, rows: OperationRow[]): Promise<ChangeContext> {
  const docIds = new Set(rows.map((r) => r.documentId));
  for (const r of rows) {
    if (r.operationType !== "ADD_RELATIONSHIP" || !r.inputJson) continue;
    try {
      const input = JSON.parse(r.inputJson) as { targetId?: unknown };
      if (typeof input.targetId === "string") docIds.add(input.targetId);
    } catch {
      // not a supersession we can read
    }
  }
  const sourceIds = [...new Set(rows.filter((r) => r.documentType === SOURCE_TYPE).map((r) => r.documentId))];
  const sourceMap = await sourceRows(db, sourceIds);
  const sources: ChangeContext["sources"] = new Map();
  const noteIds = new Set([...docIds].filter((id) => !sourceMap.has(id)));
  for (const [id, row] of sourceMap) {
    const claimIds = row.claimIds ?? [];
    sources.set(id, { title: row.title ?? id, folder: null, claimIds, addedAt: row.addedAt ?? null });
    for (const n of claimIds) noteIds.add(n);
  }

  const nodes: ChangeContext["nodes"] = new Map();
  const ids = [...noteIds];
  for (const part of chunks(ids)) {
    const found = await db.selectFrom("graph_nodes").select(["document_id", "title", "document_type", "status"]).where("document_id", "in", part).execute();
    for (const n of found) nodes.set(n.document_id, { title: n.title ?? "", documentType: n.document_type ?? "bai/knowledge-note", status: n.status, topics: [] });
    const topics = await db.selectFrom("graph_topics").select(["document_id", "name"]).where("document_id", "in", part).execute();
    for (const t of topics) nodes.get(t.document_id)?.topics.push(t.name);
  }

  const mocsByNote: ChangeContext["mocsByNote"] = new Map();
  const derivedFrom: ChangeContext["derivedFrom"] = new Map();
  const reasons = new Map<string, string | null>();
  for (const part of chunks(ids)) {
    const core = await db
      .selectFrom("graph_edges")
      .innerJoin("graph_nodes", "graph_nodes.document_id", "graph_edges.source_document_id")
      .select(["graph_edges.target_document_id as note", "graph_nodes.document_id as moc", "graph_nodes.title as title", "graph_nodes.note_type as noteType"])
      .where("graph_edges.link_type", "=", "CORE_IDEA")
      .where("graph_edges.target_document_id", "in", part)
      .execute();
    for (const c of core) {
      const tier = (/MOC \((HUB|DOMAIN|TOPIC)\)/.exec(c.noteType ?? "")?.[1] ?? "TOPIC") as MocTier;
      mocsByNote.set(c.note, [...(mocsByNote.get(c.note) ?? []), { id: c.moc, title: c.title ?? c.moc, tier }]);
    }
    for (const e of await edgeTargets(db, part, "DERIVED_FROM")) derivedFrom.set(e.source, [...(derivedFrom.get(e.source) ?? []), e.target]);
    const sup = await db
      .selectFrom("graph_edges")
      .select(["source_document_id", "target_document_id", "metadata"])
      .where("link_type", "=", "SUPERSEDES")
      .where("target_document_id", "in", part)
      .execute();
    for (const s of sup) reasons.set(`${s.source_document_id}>${s.target_document_id}`, parseEdgeMetadata(s.metadata)?.reason ?? null);
  }

  return {
    nodes,
    sources,
    mocsByNote,
    derivedFrom,
    edgeReason: (source, target, type) => (type === "SUPERSEDES" ? (reasons.get(`${source}>${target}`) ?? null) : null),
  };
}

/**
 * The change digest for a window over this index. `scope.moc` and
 * `scope.topic` are resolved here to document ids (a map through its child
 * maps; both with their notes' sources); `scope.q` must already have been
 * resolved to `documentIds` by the caller (it needs the embedder). The
 * digest echoes the caller's scope.
 */
export async function loadChanges(
  db: ReadDb,
  window: { since: string; until: string },
  scope: ChangeScope,
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<ChangeDigest> {
  let ids: Set<string> | null = scope.documentIds ? new Set(scope.documentIds) : null;
  if (scope.moc) ids = intersect(ids, await mocScope(db, scope.moc));
  if (scope.topic) ids = intersect(ids, await topicScope(db, scope.topic));

  const raw = await windowRows(db, window, ids ? [...ids] : null);
  const rows = raw.map(toRow);
  const inScopeDocs = [...new Set(rows.filter((r) => !ids || ids.has(r.documentId)).map((r) => r.documentId))];
  const baseline = (await baselineRows(db, window.since, inScopeDocs)).map(toRow);
  const ctx = await loadContext(db, rows);

  const internal: ChangeScope = { ...(ids ? { documentIds: [...ids] } : {}), ...(scope.types ? { types: scope.types } : {}) };
  // Ids came from a scope key: the caller asked for events, even if the ids are empty.
  if (!ids && (scope.q || scope.moc || scope.topic)) internal.documentIds = [];
  const digest = buildChanges(rows, baseline, ctx, window, { scope: internal, ...opts });
  return { ...digest, scope };
}
