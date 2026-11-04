/**
 * The query half of the change digest: reads a window of `graph_operations`
 * and the graph context it needs, and hands both to the pure `buildChanges`.
 *
 * Size: a window can hold tens of thousands of operations (the 2026-11-03
 * sync wrote 13,329 in hours), almost all metadata stamps and link writes.
 * Every row is read for counting, but `input_json` only for the operations
 * that can become an event (a SUPERSEDES link, a version stamp, a claim
 * edit, a lifecycle step, an ingestion) — the rest come back without it.
 * The heavy inputs — whole bodies and whole source texts — are read in a
 * second pass and only where they decide the result: a document's last
 * content write and the patches after it, a source's first and last
 * ingestion; the same before the window for the baseline.
 */
import { sql, type Kysely } from "kysely";
import type { DB } from "./schema.js";
import {
  BASELINE_OPERATION_TYPES,
  buildChanges,
  EVENT_OPERATION_TYPES,
  FIRST_RECORD_MS,
  type ChangeContext,
  type ChangeDigest,
  type ChangeScope,
  type MocTier,
  type OperationRow,
} from "./changes.js";
import type { ScopeMap, StoryContext, StoryNode } from "./changes-story.js";
import { parseEdgeMetadata } from "./edge-metadata.js";
import { KNOWLEDGE_LINK_TYPES } from "./link-types.js";
import { SOURCE_ROW_VERSION, type TimelineSourceRow } from "./source-timeline.js";

type ReadDb = Pick<Kysely<DB>, "selectFrom">;

const SOURCE_TYPE = "bai/source";
/** Bound parameter lists stay well under Postgres's 65,535. */
const CHUNK = 1000;

/** Inputs that carry a whole body or source text: fetched by id, only where they decide the result. */
const CONTENT_SET_TYPES = ["SET_CONTENT", "UPDATE_CLAIM_CONTENT"];
const PATCH = "PATCH_CONTENT";
const INGEST = "INGEST_SOURCE";
const HEAVY_TYPES = new Set([...CONTENT_SET_TYPES, PATCH, INGEST]);
/** Writes of a claim's title or description. */
const CLAIM_TYPES = new Set(["SET_TITLE", "SET_DESCRIPTION", "UPDATE_DESCRIPTION"]);
const CREATED_TYPES = new Set(["CREATE_DOCUMENT", "CREATE_MOC", "CREATE_CLAIM", "CREATE_TENSION", "CREATE_OBSERVATION"]);
/** Operation types whose small input is always needed; the two below need theirs only sometimes. */
const PLAIN_EVENT_TYPES = EVENT_OPERATION_TYPES.filter((t) => t !== "ADD_RELATIONSHIP" && t !== "SET_METADATA_FIELD" && !HEAVY_TYPES.has(t));
const SUPERSEDES_LIKE = '%"relationshipType":"SUPERSEDES"%';
const NO_TYPE_LIKE = '%"relationshipType"%';
const VERSION_LIKE = '%"field":"version"%';
/** How every timestamp the indexer writes begins (migrations.ts normalises the rest). */
const ISO_LIKE = "____-__-__T%";

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
  // A supersession (and its removal) is recorded on the replacing note, which may be outside the scope.
  const seen = new Set(out.map((r) => r.id));
  const sup = (await base()
    .where((eb) =>
      eb.or([
        eb.and([eb("operation_type", "=", "ADD_RELATIONSHIP"), eb("input_json", "like", SUPERSEDES_LIKE)]),
        eb.and([
          eb("operation_type", "=", "REMOVE_RELATIONSHIP"),
          eb.or([eb("input_json", "like", SUPERSEDES_LIKE), eb("input_json", "not like", NO_TYPE_LIKE)]),
        ]),
      ]),
    )
    .execute()) as RawRow[];
  for (const r of sup) if (!seen.has(r.id)) out.push(r);
  return out;
}

function byTimeRaw(a: RawRow, b: RawRow): number {
  return a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.index - b.index;
}

/**
 * Which heavy rows' inputs decide the digest, from rows in time order per
 * document: a document's last content write and the patches after it (all
 * patches when it has none), a source's first and last ingestion. A document
 * created in the window needs none — its edits are its creation.
 */
function decidingHeavyRows(rows: RawRow[]): string[] {
  const byDoc = new Map<string, RawRow[]>();
  for (const r of rows) byDoc.set(r.document_id, [...(byDoc.get(r.document_id) ?? []), r]);
  const wanted: string[] = [];
  for (const list of byDoc.values()) {
    list.sort(byTimeRaw);
    const ingests = list.filter((r) => r.operation_type === INGEST);
    if (ingests.length) {
      wanted.push(ingests[0].id);
      if (ingests.length > 1) wanted.push(ingests[ingests.length - 1].id);
    }
    const content = (upTo: number) => {
      let lastSet = -1;
      for (let i = 0; i < upTo; i++) if (CONTENT_SET_TYPES.includes(list[i].operation_type)) lastSet = i;
      if (lastSet >= 0) wanted.push(list[lastSet].id);
      for (let i = lastSet + 1; i < upTo; i++) if (list[i].operation_type === PATCH) wanted.push(list[i].id);
    };
    const create = list.find((r) => CREATED_TYPES.has(r.operation_type));
    if (create) {
      // Its edits are its creation — unless a title or description came after
      // its creating batch settled: then the body as first recorded and as now
      // give the revision lines added since (spec Addendum B4).
      const end = Date.parse(create.timestamp) + FIRST_RECORD_MS;
      const settled = list.findIndex((r) => Date.parse(r.timestamp) > end);
      if (settled >= 0 && list.slice(settled).some((r) => CLAIM_TYPES.has(r.operation_type))) {
        content(settled);
        content(list.length);
      }
      continue;
    }
    content(list.length);
  }
  return wanted;
}

/** Fill `input_json` of these rows, by id. */
async function fillInputs(db: ReadDb, rows: RawRow[], ids: string[]): Promise<void> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const part of chunks(ids)) {
    const found = await db.selectFrom("graph_operations").select(["id", "input_json"]).where("id", "in", part).execute();
    for (const f of found) {
      const row = byId.get(f.id);
      if (row) row.input_json = f.input_json;
    }
  }
}

/**
 * The baseline: per document, the last pre-window row of each tracked
 * operation type, and the content patches after its last content write —
 * inputs only where they decide the value. Rows whose timestamp is not ISO
 * are not "before" anything and are left out.
 */
async function baselineRows(db: ReadDb, since: string, docIds: string[]): Promise<RawRow[]> {
  const tracked = BASELINE_OPERATION_TYPES.filter((t) => t !== PATCH);
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
        "signer_address",
        sql<string | null>`case when operation_type in (${sql.join([...HEAVY_TYPES])}) then null else input_json end`.as("input_json"),
        sql<number>`row_number() over (partition by document_id, operation_type order by timestamp desc, "index" desc)`.as("rn"),
      ])
      .where("timestamp", "<", since)
      .where("timestamp", "like", ISO_LIKE)
      .where("document_id", "in", part)
      .where("operation_type", "in", tracked)
      .where((eb) => eb.or([eb("operation_type", "!=", "SET_METADATA_FIELD"), eb("input_json", "like", VERSION_LIKE)]));
    const last = (await db
      .selectFrom(ranked.as("ranked"))
      .select(["id", "document_id", "document_type", "operation_type", "timestamp", "index", "input_json", "signer_address"])
      .where("rn", "=", 1)
      .execute()) as RawRow[];
    // The last content write before the window, per document: patches before it are overwritten.
    const lastSet = new Map<string, RawRow>();
    for (const r of last) {
      if (!CONTENT_SET_TYPES.includes(r.operation_type)) continue;
      const prev = lastSet.get(r.document_id);
      if (!prev || byTimeRaw(prev, r) < 0) lastSet.set(r.document_id, r);
    }
    const patches = ((await db
      .selectFrom("graph_operations")
      .select(["id", "document_id", "document_type", "operation_type", "timestamp", "index", sql<string | null>`null`.as("input_json"), "signer_address"])
      .where("timestamp", "<", since)
      .where("timestamp", "like", ISO_LIKE)
      .where("document_id", "in", part)
      .where("operation_type", "=", PATCH)
      .execute()) as RawRow[]).filter((p) => {
      const set = lastSet.get(p.document_id);
      return !set || byTimeRaw(set, p) < 0;
    });
    const heavy = [
      ...last.filter((r) => r.operation_type === INGEST || CONTENT_SET_TYPES.includes(r.operation_type)).map((r) => r.id),
      ...patches.map((p) => p.id),
    ];
    const rows = [...last, ...patches];
    await fillInputs(db, rows, heavy);
    out.push(...rows);
  }
  return out;
}

async function loadContext(db: ReadDb, rows: OperationRow[], sourceFolders: ReadonlyMap<string, string>): Promise<ChangeContext> {
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
    sources.set(id, { title: row.title ?? id, folder: sourceFolders.get(id) ?? null, claimIds, addedAt: row.addedAt ?? null });
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

const STORY_TYPES = ["bai/knowledge-note", "bai/moc"];
const LIFECYCLE_TYPES = ["ARCHIVE_NOTE", "ARCHIVE_OBSERVATION", "RESTORE_NOTE"];

/**
 * What the knowledge story needs (spec Addendum A): notes and maps as they
 * stand now (every one unscoped; the scope's, the window's and every map
 * otherwise), the hub and its map tree, incoming knowledge-edge counts,
 * which notes were archived at `since`, and which are superseded now. The
 * then-titles come from the digest's own baseline.
 */
async function loadStoryContext(db: ReadDb, { since, until }: { since: string; until: string }, ids: Set<string> | null, rowDocs: Set<string>): Promise<StoryContext> {
  const nodes = new Map<string, StoryNode>();
  const hubs: string[] = [];
  type NodeRow = { document_id: string; title: string | null; description: string | null; document_type: string | null; status: string | null; note_type: string | null; added_at: string | null };
  const take = (rows: NodeRow[]) => {
    for (const n of rows) {
      const documentType = n.document_type ?? "bai/knowledge-note";
      nodes.set(n.document_id, { title: n.title ?? "", description: n.description, documentType, status: n.status, addedAt: n.added_at, incoming: 0 });
      if (documentType === "bai/moc" && /MOC \(HUB\)/.test(n.note_type ?? "")) hubs.push(n.document_id);
    }
  };
  const columns = ["document_id", "title", "description", "document_type", "status", "note_type", "added_at"] as const;
  if (!ids) {
    take(await db.selectFrom("graph_nodes").select([...columns]).where("document_type", "in", STORY_TYPES).execute());
  } else {
    take(await db.selectFrom("graph_nodes").select([...columns]).where("document_type", "=", "bai/moc").execute());
    // The scope's notes, and the window's (a replacing note may sit outside the scope).
    for (const part of chunks([...new Set([...ids, ...rowDocs])])) {
      take(await db.selectFrom("graph_nodes").select([...columns]).where("document_id", "in", part).where("document_type", "=", "bai/knowledge-note").execute());
    }
  }

  const childMaps = new Map<string, string[]>();
  const coreIdeas = new Map<string, string[]>();
  const derivedFrom = new Map<string, string[]>();
  const superseded = new Set<string>();
  const edges = await db
    .selectFrom("graph_edges")
    .select(["source_document_id", "target_document_id", "link_type"])
    .where("link_type", "in", ["CHILD_MOC", "CORE_IDEA", "SUPERSEDES", "DERIVED_FROM"])
    .execute();
  for (const e of edges) {
    if (e.link_type === "SUPERSEDES") superseded.add(e.target_document_id);
    else {
      const into = e.link_type === "CHILD_MOC" ? childMaps : e.link_type === "CORE_IDEA" ? coreIdeas : derivedFrom;
      const list = into.get(e.source_document_id);
      if (list) list.push(e.target_document_id);
      else into.set(e.source_document_id, [e.target_document_id]);
    }
  }

  const incoming = await db
    .selectFrom("graph_edges")
    .select(["target_document_id", sql<number>`count(*)`.as("n")])
    .where("link_type", "in", [...KNOWLEDGE_LINK_TYPES])
    .groupBy("target_document_id")
    .execute();
  for (const r of incoming) {
    const n = nodes.get(r.target_document_id);
    if (n) n.incoming = Number(r.n);
  }

  // Lifecycle steps are rare: read them all before the window, keep each note's last.
  const lifecycle = await db
    .selectFrom("graph_operations")
    .select(["document_id", "operation_type", "timestamp", "index"])
    .where("operation_type", "in", LIFECYCLE_TYPES)
    .where("timestamp", "<", since)
    .where("timestamp", "like", ISO_LIKE)
    .execute();
  const last = new Map<string, { operation_type: string; timestamp: string; index: number }>();
  for (const r of lifecycle) {
    const prev = last.get(r.document_id);
    if (!prev || prev.timestamp < r.timestamp || (prev.timestamp === r.timestamp && prev.index < r.index)) last.set(r.document_id, r);
  }
  const archivedAtSince = new Set([...last].filter(([, r]) => r.operation_type !== "RESTORE_NOTE").map(([id]) => id));

  // Every ingestion up to until, by its summary (`Ingested “…” (<git ref>)`):
  // the git ref without reading the source text (spec Addendum B4).
  const ingestRows = await db
    .selectFrom("graph_operations")
    .select(["document_id", "timestamp", "index", "summary"])
    .where("operation_type", "=", INGEST)
    .where("timestamp", "<=", until)
    .where("timestamp", "like", ISO_LIKE)
    .execute();
  ingestRows.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.index - b.index));
  const ingests = new Map<string, { at: string; ref: string | null }[]>();
  for (const r of ingestRows) {
    const entry = { at: r.timestamp, ref: ingestRef(r.summary) };
    const list = ingests.get(r.document_id);
    if (list) list.push(entry);
    else ingests.set(r.document_id, [entry]);
  }

  return { nodes, hubs, childMaps, coreIdeas, archivedAtSince, superseded, derivedFrom, ingests };
}

/** The git ref an INGEST_SOURCE summary ends with (summarize.ts: `Ingested “title” (ref)`), else null. */
export function ingestRef(summary: string | null): string | null {
  return /” \(([^()\s]+)\)$/.exec(summary ?? "")?.[1] ?? null;
}

/**
 * The maps a `q` scope may name (spec Addendum B2): the hubs (depth 0 — a
 * query naming one means the whole vault), every hub's top-level areas
 * (depth 1) and the maps below them (child maps, any depth, each at its
 * shallowest), shallowest first.
 */
export async function loadChangeMaps(db: ReadDb): Promise<ScopeMap[]> {
  const maps = await db.selectFrom("graph_nodes").select(["document_id", "title", "note_type"]).where("document_type", "=", "bai/moc").execute();
  const title = new Map(maps.map((m) => [m.document_id, m.title ?? m.document_id]));
  const hubs = new Set(maps.filter((m) => /MOC \(HUB\)/.test(m.note_type ?? "")).map((m) => m.document_id));
  const children = new Map<string, string[]>();
  for (const e of await db.selectFrom("graph_edges").select(["source_document_id", "target_document_id"]).where("link_type", "=", "CHILD_MOC").execute()) {
    const list = children.get(e.source_document_id);
    if (list) list.push(e.target_document_id);
    else children.set(e.source_document_id, [e.target_document_id]);
  }
  const out: ScopeMap[] = [...hubs].map((id) => ({ id, title: title.get(id) as string, depth: 0 }));
  const seen = new Set(hubs);
  let frontier = [...hubs];
  for (let depth = 1; frontier.length; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const child of children.get(id) ?? []) {
        if (seen.has(child) || !title.has(child)) continue;
        seen.add(child);
        next.push(child);
        out.push({ id: child, title: title.get(child) as string, depth });
      }
    }
    frontier = next;
  }
  return out;
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
  opts: { limit?: number; cursor?: string | null; sourceFolders?: ReadonlyMap<string, string> } = {},
): Promise<ChangeDigest> {
  let ids: Set<string> | null = scope.documentIds ? new Set(scope.documentIds) : null;
  if (scope.moc) ids = intersect(ids, await mocScope(db, scope.moc));
  if (scope.topic) ids = intersect(ids, await topicScope(db, scope.topic));

  const raw = await windowRows(db, window, ids ? [...ids] : null);
  await fillInputs(db, raw, decidingHeavyRows(raw));
  const rows = raw.map(toRow);
  // A document created in the window reports `created` only: it needs no baseline.
  const created = new Set(raw.filter((r) => CREATED_TYPES.has(r.operation_type)).map((r) => r.document_id));
  const inScopeDocs = [...new Set(rows.filter((r) => (!ids || ids.has(r.documentId)) && !created.has(r.documentId)).map((r) => r.documentId))];
  const baseline = (await baselineRows(db, window.since, inScopeDocs)).map(toRow);
  // A cursor page carries no story (the first page did): skip loading it.
  const [ctx, story] = await Promise.all([
    loadContext(db, rows, opts.sourceFolders ?? new Map()),
    opts.cursor ? undefined : loadStoryContext(db, window, ids, new Set(rows.map((r) => r.documentId))),
  ]);
  if (story) ctx.story = story;

  const internal: ChangeScope = { ...(ids ? { documentIds: [...ids] } : {}), ...(scope.types ? { types: scope.types } : {}) };
  // Ids came from a scope key: the caller asked for events, even if the ids are empty.
  if (!ids && (scope.q || scope.moc || scope.topic)) internal.documentIds = [];
  const digest = buildChanges(rows, baseline, ctx, window, {
    scope: internal,
    limit: opts.limit,
    cursor: opts.cursor,
    thenVsNow: Boolean(scope.q || scope.topic),
  });
  return { ...digest, scope };
}
