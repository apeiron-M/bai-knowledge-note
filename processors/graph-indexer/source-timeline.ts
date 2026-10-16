/**
 * The source timeline: what was added to a vault, when, and what each
 * addition became. One pure function, shared by the knowledge-graph subgraph
 * (server), the HTTP route, and the vault editor (its fallback against an
 * older server), so every surface groups and counts the same way.
 *
 * An **addition** is what a person did once: a file's folder, a source
 * pasted into /sources (or a `sources/batch` call), a workflow's burst into
 * its folder, an agent's session. Notes with no recorded source are grouped
 * the same way by origin. Spec: docs/superpowers/specs/2026-10-16-source-timeline-design.md.
 */

/** A drive folder, as the drive tree lists it. */
export interface TimelineFolder {
  id: string;
  name: string;
  parentFolder: string | null;
}

/** As much of a source document as the timeline reads. */
export interface TimelineSource {
  id: string;
  /** The drive node's folder. */
  parentFolder: string | null;
  /** When the document entered the vault: its header's createdAtUtcIso. */
  addedAt: string;
  /** The state's createdAt — one instant for every source of a sources/batch call. */
  batchAt: string | null;
  title: string;
  status: string;
  addedBy: string | null;
  sourceType: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  method: string | null;
  tool: string | null;
  url: string | null;
  /** The source's extractedClaims: the notes it says it became. */
  claimIds: string[];
}

/** A node of the graph index. */
export interface TimelineNode {
  documentId: string;
  documentType: string;
  title: string;
  status: string | null;
  noteType: string | null;
  /** The note's tags (the index calls them topics). */
  topics: string[];
  /** When it entered the vault; null from an index that predates the column. */
  addedAt: string | null;
  /** When it was written (provenance). */
  createdAt: string | null;
  sourceOrigin: string | null;
}

export interface TimelineEdge {
  source: string;
  target: string;
  type: string;
}

export interface TimelineInput {
  /** The vault's /sources folder; a source directly in it is an addition of its own. */
  sourcesFolderId: string | null;
  folders: readonly TimelineFolder[];
  sources: readonly TimelineSource[];
  nodes: readonly TimelineNode[];
  edges: readonly TimelineEdge[];
}

/**
 * file — an uploaded file's sources; text — pasted or ingested text;
 * feed — a workflow's delivery; agent — written by an agent;
 * written — notes made in the vault; imported — notes brought in from
 * elsewhere (an Obsidian or markdown import); unsourced — notes whose
 * source is not recorded (removed, or never set).
 */
export type AdditionKind = "file" | "text" | "feed" | "agent" | "written" | "imported" | "unsourced";

/** The kinds that are groups of notes rather than sources someone added. */
export const NOTE_GROUP_KINDS: ReadonlySet<AdditionKind> = new Set<AdditionKind>(["written", "imported", "unsourced"]);

/** Notes that arrived without a source of their own: written here, imported, or unsourced. */
export function isNoteGroup(a: Pick<TimelineAddition, "kind">): boolean {
  return NOTE_GROUP_KINDS.has(a.kind);
}

export interface TimelineAddition {
  id: string;
  kind: AdditionKind;
  title: string;
  folderId: string | null;
  addedAt: string;
  lastAddedAt: string;
  addedBy: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  method: string | null;
  tool: string | null;
  url: string | null;
  sourceType: string | null;
  sources: number;
  extracted: number;
  /** INBOX and EXTRACTING: still to be read. */
  waiting: number;
  archived: number;
  sourceIds: string[];
  notes: number;
  firstNoteAt: string | null;
  lastNoteAt: string | null;
  /** The earliest written date of its notes, when a day or more before the addition. */
  writtenFrom: string | null;
  topicIds: string[];
  linksWithin: number;
  linksToEarlier: number;
  earlier: { additionId: string; links: number }[];
  tags: { name: string; count: number }[];
  topNotes: { documentId: string; title: string }[];
}

export interface TimelineArrival {
  documentId: string;
  addedAt: string | null;
  writtenAt: string | null;
  additionId: string | null;
}

export interface TimelineTopic {
  documentId: string;
  title: string;
  addedAt: string | null;
  writtenAt: string | null;
  additionId: string | null;
}

export interface SourceTimeline {
  additions: TimelineAddition[];
  notes: TimelineArrival[];
  topics: TimelineTopic[];
  totals: { sources: number; notes: number; topics: number; links: number };
}

const NOTE = "bai/knowledge-note";
const MOC = "bai/moc";
/**
 * The links one note makes to another — not membership (CORE_IDEA, CHILD_MOC)
 * or provenance (DERIVED_FROM), which link-types.ts's KNOWLEDGE_LINK_TYPES
 * also counts.
 */
export const NOTE_LINK_TYPES: ReadonlySet<string> = new Set(["RELATES_TO", "BUILDS_ON", "CONTRADICTS", "SUPERSEDES"]);
/** Arrivals further apart than this start a new addition. */
export const ADDITION_GAP_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WRITTEN_HERE = new Set(["MANUAL", "SESSION_MINE"]);
const TOP_TAGS = 5;
const TOP_NOTES = 3;

const time = (iso: string | null | undefined): number => {
  if (!iso) return Number.NaN;
  return Date.parse(iso);
};
/**
 * Plain code-unit order, not a locale's: the server and a browser in another
 * locale must break ties the same way, or their ids would differ.
 */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** In time order; equal times by id, so the same input in any order gives the same ids. */
const byTime =
  <T>(at: (x: T) => string | null, id: (x: T) => string) =>
  (a: T, b: T) =>
    time(at(a)) - time(at(b)) || cmp(id(a), id(b));

/** Split items, already in time order, where consecutive ones are more than ADDITION_GAP_MS apart. */
function bursts<T>(items: readonly T[], at: (x: T) => string): T[][] {
  const out: T[][] = [];
  for (const item of items) {
    const last = out.at(-1);
    const prev = last?.at(-1);
    if (last && prev !== undefined && time(at(item)) - time(at(prev)) <= ADDITION_GAP_MS) last.push(item);
    else out.push([item]);
  }
  return out;
}

function kindOf(s: TimelineSource): AdditionKind {
  if (/knowledge-agent|claude code/i.test(s.tool ?? "")) return "agent";
  if (s.method === "workflow") return "feed";
  if (s.mimeType || s.method === "converted" || s.fileName) return "file";
  return "text";
}

type Draft = Omit<TimelineAddition, "notes" | "firstNoteAt" | "lastNoteAt" | "writtenFrom" | "topicIds" | "linksWithin" | "linksToEarlier" | "earlier" | "tags" | "topNotes">;

function sourceAddition(id: string, title: string, folderId: string | null, group: readonly TimelineSource[]): Draft {
  const [first] = group;
  const last = group[group.length - 1];
  const withFile = group.find((s) => s.fileName || s.mimeType) ?? first;
  const count = (status: string) => group.filter((s) => s.status === status).length;
  return {
    id,
    kind: kindOf(first),
    title,
    folderId,
    addedAt: first.addedAt,
    lastAddedAt: last.addedAt,
    addedBy: first.addedBy,
    fileName: withFile.fileName,
    mimeType: withFile.mimeType,
    sizeBytes: withFile.sizeBytes,
    method: first.method,
    tool: first.tool,
    url: first.url,
    sourceType: first.sourceType,
    sources: group.length,
    extracted: count("EXTRACTED"),
    waiting: count("INBOX") + count("EXTRACTING"),
    archived: count("ARCHIVED"),
    sourceIds: group.map((s) => s.id),
  };
}

type NoteGroupKind = "written" | "imported" | "unsourced";

const NOTE_GROUP_TITLE: Record<NoteGroupKind, string> = {
  written: "Notes written in the vault",
  imported: "Imported notes",
  unsourced: "Notes with no recorded source",
};

/** Which group a note with no source falls in, by its provenance. */
function looseKind(n: TimelineNode): NoteGroupKind {
  if (WRITTEN_HERE.has(n.sourceOrigin ?? "")) return "written";
  if (n.sourceOrigin === "IMPORT") return "imported";
  return "unsourced";
}

function noteGroup(kind: NoteGroupKind, group: readonly TimelineNode[], at: (n: TimelineNode) => string): Draft {
  return {
    id: `notes:${kind}:${group[0].documentId}`,
    kind,
    title: NOTE_GROUP_TITLE[kind],
    folderId: null,
    addedAt: at(group[0]),
    lastAddedAt: at(group[group.length - 1]),
    addedBy: null,
    fileName: null,
    mimeType: null,
    sizeBytes: null,
    method: null,
    tool: null,
    url: null,
    sourceType: null,
    sources: 0,
    extracted: 0,
    waiting: 0,
    archived: 0,
    sourceIds: [],
  };
}

export function buildSourceTimeline(input: TimelineInput): SourceTimeline {
  const folders = new Map(input.folders.map((f) => [f.id, f]));
  const rootLevel = (s: TimelineSource) => s.parentFolder == null || s.parentFolder === input.sourcesFolderId;
  const sources = [...input.sources].sort(byTime((s) => s.addedAt, (s) => s.id));

  // 1. Sources into additions.
  const drafts: Draft[] = [];
  const inFolder = new Map<string, TimelineSource[]>();
  const batches = new Map<string, TimelineSource[]>();
  const singles: TimelineSource[] = [];
  for (const s of sources) {
    if (!rootLevel(s)) {
      const list = inFolder.get(s.parentFolder as string) ?? [];
      list.push(s);
      inFolder.set(s.parentFolder as string, list);
    } else if (s.batchAt) {
      const list = batches.get(s.batchAt) ?? [];
      list.push(s);
      batches.set(s.batchAt, list);
    } else singles.push(s);
  }
  const named = (group: readonly TimelineSource[]) => (group.length > 1 ? `${group[0].title} and ${group.length - 1} more` : group[0].title);
  for (const [folderId, list] of inFolder) {
    const folder = folders.get(folderId);
    for (const group of bursts(list, (s) => s.addedAt)) drafts.push(sourceAddition(`folder:${folderId}:${group[0].id}`, folder?.name ?? named(group), folderId, group));
  }
  // Sources directly in /sources (or outside any folder) have no folder of their own.
  for (const group of batches.values()) drafts.push(sourceAddition(group.length > 1 ? `batch:${group[0].id}` : `source:${group[0].id}`, named(group), null, group));
  for (const s of singles) drafts.push(sourceAddition(`source:${s.id}`, s.title, null, [s]));

  // 2. Notes to additions: DERIVED_FROM first, then the sources' extracted claims.
  const notes = input.nodes.filter((n) => n.documentType === NOTE);
  const noteIds = new Set(notes.map((n) => n.documentId));
  const sourceDraft = new Map<string, Draft>();
  for (const d of drafts) for (const id of d.sourceIds) sourceDraft.set(id, d);
  const noteDraft = new Map<string, Draft>();
  const earlierOf = (a: Draft | undefined, b: Draft) => {
    if (!a) return b;
    const d = time(a.addedAt) - time(b.addedAt);
    return d < 0 || (d === 0 && a.id <= b.id) ? a : b;
  };
  for (const e of input.edges) {
    if (e.type !== "DERIVED_FROM" || !noteIds.has(e.source)) continue;
    const d = sourceDraft.get(e.target);
    if (d) noteDraft.set(e.source, earlierOf(noteDraft.get(e.source), d));
  }
  for (const s of sources) {
    const d = sourceDraft.get(s.id);
    if (!d) continue;
    for (const id of s.claimIds) if (noteIds.has(id) && !noteDraft.has(id)) noteDraft.set(id, d);
  }

  // 3. Notes with no source: grouped by origin, in bursts.
  const arrivedAt = (n: TimelineNode) => n.addedAt ?? n.createdAt;
  const loose = notes.filter((n) => !noteDraft.has(n.documentId) && arrivedAt(n)).sort(byTime(arrivedAt, (n) => n.documentId));
  for (const kind of ["unsourced", "imported", "written"] as const) {
    const mine = loose.filter((n) => looseKind(n) === kind);
    for (const group of bursts(mine, (n) => arrivedAt(n) as string)) {
      const d = noteGroup(kind, group, (n) => arrivedAt(n) as string);
      drafts.push(d);
      for (const n of group) noteDraft.set(n.documentId, d);
    }
  }

  drafts.sort((a, b) => time(a.addedAt) - time(b.addedAt) || cmp(a.id, b.id));
  const order = new Map(drafts.map((d, i) => [d.id, i]));
  const draftById = new Map(drafts.map((d) => [d.id, d]));

  // 4. What each addition became.
  const notesOf = new Map<string, TimelineNode[]>();
  for (const n of notes) {
    const d = noteDraft.get(n.documentId);
    if (!d) continue;
    const list = notesOf.get(d.id) ?? [];
    list.push(n);
    notesOf.set(d.id, list);
  }
  const degree = new Map<string, number>();
  const within = new Map<string, number>();
  const toEarlier = new Map<string, Map<string, number>>();
  let links = 0;
  for (const e of input.edges) {
    if (!NOTE_LINK_TYPES.has(e.type)) continue;
    links++;
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    const a = noteDraft.get(e.source);
    const b = noteDraft.get(e.target);
    if (!a || !b) continue;
    if (a === b) {
      within.set(a.id, (within.get(a.id) ?? 0) + 1);
      continue;
    }
    const [later, earlier] = (order.get(a.id) as number) > (order.get(b.id) as number) ? [a, b] : [b, a];
    const m = toEarlier.get(later.id) ?? new Map<string, number>();
    m.set(earlier.id, (m.get(earlier.id) ?? 0) + 1);
    toEarlier.set(later.id, m);
  }

  // 5. Topics: the addition most of its notes came from — if the topic did
  // not exist before it — else the latest addition at or before the topic.
  const members = new Map<string, string[]>();
  for (const e of input.edges) {
    if (e.type !== "CORE_IDEA") continue;
    const list = members.get(e.source) ?? [];
    list.push(e.target);
    members.set(e.source, list);
  }
  const topics: TimelineTopic[] = input.nodes
    .filter((n) => n.documentType === MOC)
    .map((m) => {
      const votes = new Map<string, number>();
      const counted = (members.get(m.documentId) ?? []).filter((id) => noteDraft.has(id));
      for (const id of counted) {
        const d = noteDraft.get(id) as Draft;
        votes.set(d.id, (votes.get(d.id) ?? 0) + 1);
      }
      let additionId: string | null = null;
      const addedAt = arrivedAt(m);
      for (const [id, v] of votes) {
        if (v / counted.length <= 0.5) continue;
        // A topic that was already there was not started by an addition that
        // later filled it. Within a burst's window it counts as the
        // addition's own: a topic is often made moments before its notes.
        const d = draftById.get(id);
        if (addedAt && d && time(addedAt) < time(d.addedAt) - ADDITION_GAP_MS) continue;
        additionId = id;
      }
      if (!additionId && addedAt) {
        const before = drafts.filter((d) => time(d.addedAt) <= time(addedAt));
        additionId = before.at(-1)?.id ?? null;
      }
      return { documentId: m.documentId, title: m.title, addedAt, writtenAt: m.createdAt, additionId };
    })
    .sort((a, b) => time(a.addedAt) - time(b.addedAt) || cmp(a.documentId, b.documentId));

  const additions: TimelineAddition[] = drafts.map((d) => {
    const mine = notesOf.get(d.id) ?? [];
    const times = mine.map(arrivedAt).filter((t): t is string => Boolean(t)).sort((a, b) => time(a) - time(b));
    const written = mine.map((n) => n.createdAt).filter((t): t is string => Boolean(t)).sort((a, b) => time(a) - time(b));
    const writtenFrom = written[0] && time(d.addedAt) - time(written[0]) >= DAY_MS ? written[0] : null;
    const tagCount = new Map<string, number>();
    for (const n of mine) for (const t of n.topics) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    const earlier = [...(toEarlier.get(d.id) ?? new Map<string, number>())]
      .map(([additionId, n]) => ({ additionId, links: n }))
      .sort((a, b) => b.links - a.links || (order.get(a.additionId) as number) - (order.get(b.additionId) as number));
    return {
      ...d,
      notes: mine.length,
      firstNoteAt: times[0] ?? null,
      lastNoteAt: times.at(-1) ?? null,
      writtenFrom,
      topicIds: topics.filter((t) => t.additionId === d.id).map((t) => t.documentId),
      linksWithin: within.get(d.id) ?? 0,
      linksToEarlier: earlier.reduce((s, x) => s + x.links, 0),
      earlier,
      tags: [...tagCount]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || cmp(a.name, b.name))
        .slice(0, TOP_TAGS),
      topNotes: [...mine]
        .sort(
          (a, b) =>
            (degree.get(b.documentId) ?? 0) - (degree.get(a.documentId) ?? 0) || time(arrivedAt(a)) - time(arrivedAt(b)) || cmp(a.documentId, b.documentId),
        )
        .slice(0, TOP_NOTES)
        .map((n) => ({ documentId: n.documentId, title: n.title })),
    };
  });

  return {
    additions,
    notes: notes
      .map((n) => ({ documentId: n.documentId, addedAt: arrivedAt(n), writtenAt: n.createdAt, additionId: noteDraft.get(n.documentId)?.id ?? null }))
      .sort((a, b) => time(a.addedAt) - time(b.addedAt) || cmp(a.documentId, b.documentId)),
    topics,
    totals: { sources: input.sources.length, notes: notes.length, topics: topics.length, links },
  };
}

// --- reading the vault's tree and documents, the same way on server and browser ---

/** The vault's /sources folder, as the Sources view finds it: the top-level folder named exactly "sources". */
export function findSourcesRoot(folders: readonly TimelineFolder[]): string | null {
  return folders.find((f) => !f.parentFolder && f.name === "sources")?.id ?? null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** extractedClaims entries are note ids, or `{ claimRef }` objects in older documents. */
function claimIdsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((c: unknown) => (typeof c === "string" ? c : c && typeof c === "object" ? str((c as { claimRef?: unknown }).claimRef) : null))
    .filter((c): c is string => Boolean(c));
}

/** The source document type. */
export const SOURCE_DOCUMENT_TYPE = "bai/source";

/** A source as the index keeps it (`graph_sources`): all the timeline reads but its place in the tree. */
export type TimelineSourceRow = Omit<TimelineSource, "parentFolder">;

/** The shape of `graph_sources.row_json`. A row of another version is read again from its document. */
export const SOURCE_ROW_VERSION = 1;

/**
 * A document's global revision, from its header — the indexer's resulting
 * state and a document read both carry it, so the two can be compared
 * (timestamps cannot: an operation's is the client's clock). -1 when unknown.
 */
export function revisionOf(doc: unknown): number {
  const r = (doc as { header?: { revision?: { global?: unknown } } } | null)?.header?.revision?.global;
  return typeof r === "number" && Number.isFinite(r) ? r : -1;
}

/** A bai/source document placed in the tree; null for anything that is not one. */
export function sourceFromDocument(doc: unknown, parentFolder: string | null): TimelineSource | null {
  const row = sourceRowOf(doc);
  return row ? { ...row, parentFolder } : null;
}

/** A bai/source document (header + state) as the timeline reads it; null for anything that is not one. */
export function sourceRowOf(doc: unknown): TimelineSourceRow | null {
  const d = doc as {
    header?: { id?: unknown; name?: unknown; createdAtUtcIso?: unknown };
    state?: { global?: Record<string, unknown> };
  } | null;
  const id = str(d?.header?.id);
  const g = d?.state?.global;
  if (!id || !g) return null;
  const provenance = (g.provenance && typeof g.provenance === "object" ? g.provenance : {}) as Record<string, unknown>;
  const batchAt = str(g.createdAt);
  const addedAt = str(d.header?.createdAtUtcIso) ?? batchAt;
  // A source with no time at all cannot be placed on a timeline.
  if (!addedAt) return null;
  return {
    id,
    addedAt,
    batchAt,
    title: str(g.title) ?? str(d.header?.name) ?? id,
    status: str(g.status) ?? "INBOX",
    addedBy: str(g.createdBy),
    sourceType: str(g.sourceType),
    fileName: str(g.originalFileName),
    mimeType: str(g.originalMimeType),
    sizeBytes: num(g.originalSizeBytes),
    method: str(provenance.method),
    tool: str(provenance.tool),
    url: str(provenance.url),
    claimIds: claimIdsOf(g.extractedClaims),
  };
}
