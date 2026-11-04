/**
 * The knowledge story of a change digest: what the vault knows now that it
 * did not before, by the hub's main areas. Spec: Addendum A of
 * docs/superpowers/specs/2026-11-04-change-history-design.md.
 *
 * Pure, like `changes.ts` (which calls it): no kysely, no processor, so the
 * browser chat may import it. The query layer loads a {@link StoryContext};
 * the events and each document's then-values come from `buildChanges`.
 */
import type { ChangeEvent } from "./changes.js";

export const MAX_NEW_CLAIMS = 8;
export const MAX_CHANGED_CLAIMS = 8;
export const MAX_RETIRED_CLAIMS = 5;
export const MAX_THEN_VS_NOW = 12;

const NOTE_TYPE = "bai/knowledge-note";
const MOC_TYPE = "bai/moc";
const ARCHIVED = "ARCHIVED";

/** A note or map as the story counts it, as it stands now. */
export interface StoryNode {
  title: string;
  description: string | null;
  documentType: string;
  status: string | null;
  /** When the document entered the vault (graph_nodes.added_at); null when nothing says. */
  addedAt: string | null;
  /** Incoming knowledge edges (graph_edges). */
  incoming: number;
}

export interface StoryContext {
  /** Every note and map the story may count (the whole vault, or the scope plus every map). */
  nodes: Map<string, StoryNode>;
  /** The HUB maps; their CHILD_MOC maps are the main areas. */
  hubs: string[];
  /** CHILD_MOC edges, map → child maps. */
  childMaps: Map<string, string[]>;
  /** CORE_IDEA edges, map → notes. */
  coreIdeas: Map<string, string[]>;
  /** Notes whose last lifecycle operation before `since` archived them. */
  archivedAtSince: Set<string>;
  /** Notes a SUPERSEDES edge points at now. */
  superseded: Set<string>;
  /** DERIVED_FROM edges, note → sources (for an area's source versions). */
  derivedFrom?: Map<string, string[]>;
  /** Each source's ingestions up to `until`, in time order, with the git ref each recorded (null: none). */
  ingests?: Map<string, { at: string; ref: string | null }[]>;
  /** The vault's first recorded activity: its earliest operation or added_at (Addendum C2); null when it has none. */
  vaultStart?: string | null;
}

export interface Claim {
  documentId: string;
  claim: string;
  gist: string | null;
  /** On a then-claim of a note created in the window: when its first recorded state was written. */
  thenAt?: string;
}

export interface Shift {
  documentId: string;
  then: { claim: string; gist: string | null };
  now: { claim: string; gist: string | null };
  why: string | null;
  replacedBy?: string;
  /** For a note created in the window: when its first recorded state (the then) was written. */
  thenAt?: string;
}

export interface StoryArea {
  /** Null for "Elsewhere": notes in no main area. */
  id: string | null;
  title: string;
  notesThen: number;
  notesNow: number;
  /** Uncapped: how many new, changed and retired claims the area has (the lists are capped). */
  newCount: number;
  changedCount: number;
  retiredCount: number;
  /** Supersessions that merged twin notes: counted, never listed as changed (Addendum B3). */
  mergedCount: number;
  /** The git refs of the area's sources: as they stood at since (else first ingested) → latest. Absent without refs. */
  versions?: { first: string | null; now: string | null };
  newClaims: Claim[];
  changedClaims: Shift[];
  retiredClaims: Claim[];
}

export interface ChangeStory {
  growth: {
    notesThen: number;
    notesNow: number;
    /** When `since` predates the vault's first recorded activity: that activity — growth is counted from it (Addendum C2). */
    from?: string;
    newAreas: { id: string; title: string }[];
    newMaps: { id: string; title: string; area: string | null }[];
  };
  areas: StoryArea[];
}

export interface ThenVsNow {
  /** Claims as they stood at since that read differently now (or are gone). */
  then: Claim[];
  /** Claims as they stand now that read differently at since (or are new). */
  now: Claim[];
  /** Claims held at since and now in the same words: listed once. */
  unchanged: Claim[];
}

/**
 * A document's title and description at `since`, where a baseline recorded
 * them; for a note created in the window, its first recorded state, with
 * when (`at`) and the revision-history lines added since (Addendum B4).
 */
export type ThenFields = Map<string, { title: string | null; description: string | null; at?: string; revisionNotes?: string[] }>;

/**
 * The hub's top-level areas (by title) and, for every map and note in an
 * area's subtree (child maps, any depth; their CORE_IDEA notes), the areas
 * that hold it. An area itself belongs to its own area.
 */
export function areasOf(s: StoryContext): { areas: { id: string; title: string }[]; areasByDoc: Map<string, string[]> } {
  const ids = [...new Set(s.hubs.flatMap((h) => s.childMaps.get(h) ?? []))].filter((id) => !s.hubs.includes(id));
  const areas = ids
    .map((id) => ({ id, title: s.nodes.get(id)?.title || id }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const areasByDoc = new Map<string, string[]>();
  const add = (doc: string, area: string) => {
    const list = areasByDoc.get(doc);
    if (!list) areasByDoc.set(doc, [area]);
    else if (!list.includes(area)) list.push(area);
  };
  for (const area of areas) {
    const maps = new Set([area.id]);
    let frontier = [area.id];
    while (frontier.length) {
      const next: string[] = [];
      for (const m of frontier) {
        for (const child of s.childMaps.get(m) ?? []) {
          if (maps.has(child) || s.hubs.includes(child)) continue;
          maps.add(child);
          next.push(child);
        }
      }
      frontier = next;
    }
    for (const m of maps) {
      add(m, area.id);
      for (const n of s.coreIdeas.get(m) ?? []) add(n, area.id);
    }
  }
  return { areas, areasByDoc };
}

/** Words too common to tell two claims apart. */
const STOPWORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "its", "of", "on", "or", "so", "that", "the", "their", "this", "to", "with"]);

/** Words ending in "s" that are not plurals: folding them would clip them ("does" → "doe"). */
const NOT_PLURAL = new Set(["does", "goes", "always", "perhaps", "whereas", "news", "series", "species"]);

/** A plural "s" to drop: not "ss", "us" or "is" (process, status, analysis), nor a word in {@link NOT_PLURAL}. */
function foldPlural(w: string): string {
  return w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w) && !NOT_PLURAL.has(w) ? w.slice(0, -1) : w;
}

/** A claim's words, lowercased, without punctuation, stopwords or a plural "s". */
export function claimTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!w || STOPWORDS.has(w)) continue;
    out.add(foldPlural(w));
  }
  return out;
}

/** Jaccard similarity of two claims' {@link claimTokens}. */
export function claimSimilarity(a: string, b: string): number {
  const x = claimTokens(a);
  const y = claimTokens(b);
  if (!x.size && !y.size) return 1;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** A map a `q` scope may name: a hub (depth 0), a hub area (depth 1) or a map below one. */
export interface ScopeMap {
  id: string;
  title: string;
  depth: number;
  /** The top-level area the map sits under (itself for an area); null for a hub. Absent: an area is its own. */
  area?: string | null;
}

/**
 * Words a question wraps its subject in ("what changed in …", "how does …
 * work now"): not content, so a map's coverage of the query ignores them.
 */
const QUERY_FILLER = new Set(
  ["what", "how", "why", "when", "where", "which", "who", "did", "does", "do", "done", "has", "have", "had", "was", "were", "been",
    "work", "works", "worked", "working", "change", "changed", "changes", "new", "now", "then", "lately", "recently", "since",
    "today", "about", "tell", "me", "we", "our", "us", "you", "i",
    // A period is not a subject (Addendum C1): "since September", "this summer", "last year".
    "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
    "spring", "summer", "autumn", "fall", "winter", "last", "past", "week", "month", "year", "ago", "until", "between"].map(foldPlural),
);
/** A map whose words are a subset of the query must cover at least this share of the query's content words. */
export const MAP_COVERAGE = 0.5;

/**
 * The map a query names (spec Addendum B2, tightened after review): by whole
 * words, case-insensitive, plurals folded, the question's filler words
 * ({@link QUERY_FILLER}) left out. A map matches when its title holds every
 * content word of the query, or when the query holds every word of its title
 * and the title covers ≥ {@link MAP_COVERAGE} of the query's content words —
 * or it is the only map that shares any word with the query. The best is
 * the exact word set, then the shallower (an area before its maps), then the
 * shorter title; when the best two tie on all three, nothing decides between
 * them and the query searches instead (null). Null when none matches.
 */
export function matchMapTitle(query: string, maps: readonly ScopeMap[]): ScopeMap | null {
  const q = queryWords(query);
  if (!q.size) return null;
  const titled = maps.map((map) => ({ map, t: claimTokens(map.title) })).filter((m) => m.t.size);
  const sharing = titled.filter(({ t }) => [...t].some((w) => q.has(w))).length;
  const hits: { map: ScopeMap; exact: boolean; size: number }[] = [];
  for (const { map, t } of titled) {
    const qInT = [...q].every((w) => t.has(w));
    const tInQ = [...t].every((w) => q.has(w));
    const covers = t.size / q.size >= MAP_COVERAGE || sharing === 1;
    if (qInT || (tInQ && covers)) hits.push({ map, exact: qInT && tInQ, size: t.size });
  }
  const rank = (a: (typeof hits)[number], b: (typeof hits)[number]) => Number(b.exact) - Number(a.exact) || a.map.depth - b.map.depth || a.size - b.size;
  hits.sort(rank);
  // Two hubs (depth 0) may tie: both are the whole vault.
  if (hits.length > 1 && rank(hits[0], hits[1]) === 0 && hits[0].map.depth > 0) return null;
  return hits[0]?.map ?? null;
}

/** The content words of a question: its {@link claimTokens} without {@link QUERY_FILLER}. */
function queryWords(query: string): Set<string> {
  return new Set([...claimTokens(query)].filter((w) => !QUERY_FILLER.has(w)));
}

/** An area is in a `q` scope when it holds at least this share of the query's note hits (Addendum C1c). */
export const AREA_HIT_SHARE = 0.1;
/** At most this many areas make one `q` scope. */
export const MAX_SCOPE_AREAS = 8;
/** A map below an area replaces the selected areas when it holds at least this share of their hits. */
export const NARROW_HIT_SHARE = 0.6;

/**
 * The areas a specific term means (spec Addendum C1c): its top semantic note
 * hits are counted per top-level area subtree (`mapNotes`: each map's notes,
 * its descendant maps' included; a hit in two areas counts for both), and
 * every area holding at least {@link AREA_HIT_SHARE} of all the hits is
 * selected, most hits first, at most {@link MAX_SCOPE_AREAS}. When one map
 * below an area holds at least {@link NARROW_HIT_SHARE} of the selected
 * areas' hits, it alone is the scope (the one with most of them; a tie goes
 * to the deeper map). Null when no area holds enough: search instead.
 */
export function selectAreasByHits(hits: readonly string[], maps: readonly ScopeMap[], mapNotes: ReadonlyMap<string, ReadonlySet<string>>): ScopeMap[] | null {
  const all = new Set(hits);
  if (!all.size) return null;
  const inMap = (id: string, among: ReadonlySet<string>) => {
    const notes = mapNotes.get(id);
    return notes ? [...among].filter((n) => notes.has(n)) : [];
  };
  const selected = maps
    .filter((m) => m.depth === 1)
    .map((area) => ({ area, hits: inMap(area.id, all) }))
    .filter((a) => a.hits.length >= AREA_HIT_SHARE * all.size)
    .sort((a, b) => b.hits.length - a.hits.length || a.area.title.localeCompare(b.area.title))
    .slice(0, MAX_SCOPE_AREAS);
  if (!selected.length) return null;
  const covered = new Set(selected.flatMap((a) => a.hits));
  const narrow = maps
    .filter((m) => m.depth >= 2)
    .map((map) => ({ map, count: inMap(map.id, covered).length }))
    .filter((m) => m.count >= NARROW_HIT_SHARE * covered.size)
    .sort((a, b) => b.count - a.count || b.map.depth - a.map.depth || a.map.title.localeCompare(b.map.title))
    .at(0);
  return narrow ? [narrow.map] : selected.map((a) => a.area);
}

/**
 * A SUPERSEDES reason that says the two notes were one claim written twice —
 * anchored phrases only (spec Addendum B corrections): a reason that merely
 * mentions "duplicate operations" or "merged into the reactor" is a change.
 */
const DUPLICATE_REASON = [
  /^\s*same (claim|point)\b/i,
  /already makes this claim/i,
  /\btwin\b/i,
  /\bduplicate (of|note|claim)\b/i,
  /\bidentical claim\b/i,
  /\bredundant with\b/i,
  /merged (into|with) (the )?(newer|older|surviving|twin)/i,
  // Addendum C6: a rewording whose reason says it states the same thing.
  /\bstates the same\b/i,
  /\bsame (floor|rule|limit|default)\b/i,
];
/** With no reason, at or above this title similarity a supersession is a duplicate merge. */
export const MERGE_SIMILARITY = 0.8;
/** Words that turn a claim around: a near-identical title that adds or drops one is a change. */
const NEGATIONS = new Set(["not", "no", "never", "without", "cannot", "nor", "none", "isn", "aren", "doesn", "don", "won", "wasn", "weren", "can"]);

/**
 * A supersession that merged twin notes (spec Addendum B3, corrected after
 * review): its reason holds an anchored duplicate phrase, or it has no reason
 * and the titles are near-identical (Jaccard ≥ {@link MERGE_SIMILARITY}) with
 * no negation, digit or version among the words that differ. Not a change in
 * understanding.
 */
export function isDuplicateMerge(then: string, now: string, reason: string | null): boolean {
  if (reason !== null && reason.trim() !== "") return DUPLICATE_REASON.some((re) => re.test(reason));
  if (claimSimilarity(then, now) < MERGE_SIMILARITY) return false;
  const a = claimTokens(then);
  const b = claimTokens(now);
  const differing = [...a].filter((w) => !b.has(w)).concat([...b].filter((w) => !a.has(w)));
  return !differing.some((w) => NEGATIONS.has(w) || /\d/.test(w));
}

function differs(a: { claim: string; gist: string | null }, b: { claim: string; gist: string | null }): boolean {
  return a.claim !== b.claim || (a.gist ?? "") !== (b.gist ?? "");
}

/** What buildStory and buildThenVsNow both read, computed once per digest by {@link storyFacts}. */
export interface Facts {
  since: string;
  areas: { id: string; title: string }[];
  areasByDoc: Map<string, string[]>;
  /** Created in the window (an event, or `addedAt` inside it). */
  created: Set<string>;
  createdAt: Map<string, string>;
  archivedInWindow: Set<string>;
  supersededInWindow: Set<string>;
  /** Replacing notes of in-window supersessions. */
  replacements: Set<string>;
  /** Replacing notes the story shows as a shift's now (never also as new). */
  shiftReplacements: Set<string>;
  shifts: Map<string, Shift>;
  /** Notes created in the window whose first recorded state is the then: when it was written. */
  firstAt: Map<string, string>;
  /** Notes merged into a twin in the window (old note → its replacement). */
  merged: Map<string, string>;
  retired: Set<string>;
  inScope: (id: string) => boolean;
  thenOf: (id: string) => { claim: string; gist: string | null };
  nowOf: (id: string) => { claim: string; gist: string | null };
  isNote: (id: string) => boolean;
  liveThen: (id: string) => boolean;
  liveNow: (id: string) => boolean;
}

export function storyFacts(events: ChangeEvent[], thenFields: ThenFields, s: StoryContext, window: { since: string; until: string }, ids: Set<string> | null): Facts {
  const { areas, areasByDoc } = areasOf(s);
  const inScope = (id: string) => !ids || ids.has(id);
  const node = (id: string) => s.nodes.get(id);
  const created = new Set<string>();
  const createdAt = new Map<string, string>();
  const archivedInWindow = new Set<string>();
  const supersededInWindow = new Set<string>();
  const replacements = new Set<string>();
  for (const e of events) {
    if (e.kind === "created") {
      created.add(e.documentId);
      createdAt.set(e.documentId, e.at);
    } else if (e.kind === "archived") archivedInWindow.add(e.documentId);
    else if (e.kind === "superseded" && e.supersededBy) {
      supersededInWindow.add(e.documentId);
      replacements.add(e.supersededBy.documentId);
    }
  }
  for (const [id, n] of s.nodes) {
    if (n.addedAt && n.addedAt >= window.since && n.addedAt <= window.until && !created.has(id)) {
      created.add(id);
      createdAt.set(id, n.addedAt);
    }
  }
  const nowOf = (id: string) => ({ claim: node(id)?.title || id, gist: node(id)?.description ?? null });
  const thenOf = (id: string) => {
    const now = nowOf(id);
    const then = thenFields.get(id);
    return { claim: then?.title ?? now.claim, gist: then?.description ?? now.gist };
  };
  const isNote = (id: string) => node(id)?.documentType === NOTE_TYPE;
  const archivedNow = (id: string) => (node(id)?.status ?? "").toUpperCase() === ARCHIVED;
  const liveNow = (id: string) => isNote(id) && !archivedNow(id);
  // Archived at since: its last lifecycle step before the window archived it,
  // or it is archived now and was not archived in the window.
  const liveThen = (id: string) =>
    isNote(id) &&
    !created.has(id) &&
    !(node(id)?.addedAt && (node(id)?.addedAt as string) > window.until) &&
    !s.archivedAtSince.has(id) &&
    !(archivedNow(id) && !archivedInWindow.has(id));

  const shifts = new Map<string, Shift>();
  const merged = new Map<string, string>();
  for (const e of events) {
    if (!isNote(e.documentId) || !inScope(e.documentId)) continue;
    if (e.kind === "superseded" && e.supersededBy) {
      const then = thenOf(e.documentId);
      const now = nowOf(e.supersededBy.documentId);
      if (node(e.supersededBy.documentId) === undefined && e.supersededBy.title) now.claim = e.supersededBy.title;
      if (isDuplicateMerge(then.claim, now.claim, e.supersededBy.reason)) {
        merged.set(e.documentId, e.supersededBy.documentId);
        shifts.delete(e.documentId);
      } else if (differs(then, now)) {
        // Created in the window too: its then is as first recorded (Addendum B corrections).
        const at = created.has(e.documentId) ? thenFields.get(e.documentId)?.at : undefined;
        shifts.set(e.documentId, { documentId: e.documentId, then, now, why: e.supersededBy.reason, replacedBy: e.supersededBy.documentId, ...(at ? { thenAt: at } : {}) });
      }
    } else if (e.kind === "revised" && !shifts.has(e.documentId) && !merged.has(e.documentId) && (e.fields?.title || e.fields?.description)) {
      const then = thenOf(e.documentId);
      const now = nowOf(e.documentId);
      if (differs(then, now)) shifts.set(e.documentId, { documentId: e.documentId, then, now, why: e.revisionNotes?.length ? e.revisionNotes.join("; ") : null });
    } else if (e.kind === "created" && !shifts.has(e.documentId) && !merged.has(e.documentId)) {
      // Created in the window and revised after its creating batch settled.
      const first = thenFields.get(e.documentId);
      if (!first?.at) continue;
      const then = thenOf(e.documentId);
      const now = nowOf(e.documentId);
      if (!differs(then, now)) continue;
      const why = first.revisionNotes?.length ? first.revisionNotes.join("; ") : null;
      shifts.set(e.documentId, { documentId: e.documentId, then, now, why, thenAt: first.at });
    }
  }
  // A note created in the window reports `created` only, never `archived`:
  // archived now, it was archived in the window too.
  for (const e of events) if (e.kind === "created" && archivedNow(e.documentId)) archivedInWindow.add(e.documentId);
  // A note created in the window always says when its then was first recorded:
  // its creating batch, else its creation time — added_at when the CREATE row was lost (Addendum C4).
  for (const sh of shifts.values()) {
    if (sh.thenAt || !created.has(sh.documentId)) continue;
    const at = thenFields.get(sh.documentId)?.at ?? createdAt.get(sh.documentId);
    if (at) sh.thenAt = at;
  }
  const firstAt = new Map([...shifts.values()].flatMap((sh) => (sh.thenAt ? [[sh.documentId, sh.thenAt] as const] : [])));
  // Retired: archived in the window, still archived, and replaced by nothing — ever.
  const retired = new Set(
    [...archivedInWindow].filter((id) => isNote(id) && inScope(id) && archivedNow(id) && !supersededInWindow.has(id) && !s.superseded.has(id)),
  );
  // A retired note is not also a changed one: it holds nothing now (its then keeps its thenAt).
  for (const id of retired) {
    shifts.delete(id);
    const at = created.has(id) ? thenFields.get(id)?.at : undefined;
    if (at) firstAt.set(id, at);
  }
  const shiftReplacements = new Set([...shifts.values()].flatMap((sh) => (sh.replacedBy ? [sh.replacedBy] : [])));
  return { since: window.since, areas, areasByDoc, created, createdAt, archivedInWindow, supersededInWindow, replacements, shiftReplacements, shifts, firstAt, merged, retired, inScope, thenOf, nowOf, isNote, liveThen, liveNow };
}

const claimOf = (f: Facts, id: string, then = false): Claim => {
  const at = then ? f.firstAt.get(id) : undefined;
  return { documentId: id, ...(then ? f.thenOf(id) : f.nowOf(id)), ...(at ? { thenAt: at } : {}) };
};

/**
 * The git refs of these sources (spec Addendum B4): first = the earliest of
 * each source's ref standing at `since` (its last ingestion before, else its
 * first in the window); now = the latest ref. Only ingestions that recorded a
 * ref count; null when none did.
 */
export function sourceVersions(sources: Iterable<string>, ingests: Map<string, { at: string; ref: string | null }[]>, since: string): { first: string | null; now: string | null } | null {
  let first: { at: string; ref: string } | null = null;
  let now: { at: string; ref: string } | null = null;
  for (const id of sources) {
    const list = (ingests.get(id) ?? []).filter((i): i is { at: string; ref: string } => i.ref !== null);
    if (!list.length) continue;
    const then = [...list].reverse().find((i) => i.at < since) ?? list[0];
    const last = list[list.length - 1];
    if (!first || then.at < first.at) first = then;
    if (!now || last.at > now.at) now = last;
  }
  return first || now ? { first: first?.ref ?? null, now: now?.ref ?? null } : null;
}

/** The story: growth, then each main area with any change, most changed first; "Elsewhere" last. */
export function buildStory(f: Facts, s: StoryContext): ChangeStory {
  const incoming = (id: string) => s.nodes.get(id)?.incoming ?? 0;
  const notes = [...s.nodes.keys()].filter((id) => f.isNote(id) && f.inScope(id));

  const areaTitle = new Map(f.areas.map((a) => [a.id, a.title]));
  const isArea = (id: string) => areaTitle.has(id);
  const maps = [...s.nodes].filter(([id, n]) => n.documentType === MOC_TYPE && f.inScope(id) && f.created.has(id) && !s.hubs.includes(id));
  const growth: ChangeStory["growth"] = {
    notesThen: notes.filter(f.liveThen).length,
    notesNow: notes.filter(f.liveNow).length,
    ...(s.vaultStart && s.vaultStart > f.since ? { from: s.vaultStart } : {}),
    newAreas: maps.filter(([id]) => isArea(id)).map(([id, n]) => ({ id, title: n.title || id })),
    newMaps: maps
      .filter(([id]) => !isArea(id))
      .map(([id, n]) => {
        const area = f.areasByDoc.get(id)?.[0];
        return { id, title: n.title || id, area: area ? (areaTitle.get(area) ?? null) : null };
      }),
  };

  const push = <T>(into: Map<string | null, T[]>, key: string | null, value: T) => {
    const list = into.get(key);
    if (list) list.push(value);
    else into.set(key, [value]);
  };
  const buckets = new Map<string | null, string[]>();
  for (const id of notes) for (const a of f.areasByDoc.get(id) ?? [null]) push(buckets, a, id);
  // A shift is filed under the old note's areas, else the replacement's
  // (an unmapped note replaced by a mapped one), else Elsewhere.
  // Event order: supersessions first, then revisions by size.
  const shiftsByArea = new Map<string | null, Shift[]>();
  for (const sh of f.shifts.values()) {
    const at = f.areasByDoc.get(sh.documentId) ?? (sh.replacedBy ? f.areasByDoc.get(sh.replacedBy) : undefined) ?? [null];
    for (const a of at) push(shiftsByArea, a, sh);
  }
  // A merge is filed like a shift: the old note's areas, else the replacement's.
  const mergedByArea = new Map<string | null, number>();
  for (const [old, by] of f.merged) {
    for (const a of f.areasByDoc.get(old) ?? f.areasByDoc.get(by) ?? [null]) mergedByArea.set(a, (mergedByArea.get(a) ?? 0) + 1);
  }
  const areas: (StoryArea & { weight: number })[] = [];
  for (const id of new Set([...buckets.keys(), ...shiftsByArea.keys(), ...mergedByArea.keys()])) {
    const members = buckets.get(id) ?? [];
    const newIds = members
      .filter((n) => f.created.has(n) && f.liveNow(n) && !f.shiftReplacements.has(n) && !f.merged.has(n))
      .sort(
        (a, b) =>
          incoming(b) - incoming(a) ||
          (f.createdAt.get(b) ?? "").localeCompare(f.createdAt.get(a) ?? "") ||
          a.localeCompare(b),
      );
    const shifts = shiftsByArea.get(id) ?? [];
    const retired = members.filter((n) => f.retired.has(n));
    const notesThen = members.filter(f.liveThen).length;
    const notesNow = members.filter(f.liveNow).length;
    const mergedCount = mergedByArea.get(id) ?? 0;
    const versions = s.ingests && s.derivedFrom ? sourceVersions(new Set(members.flatMap((n) => s.derivedFrom?.get(n) ?? [])), s.ingests, f.since) : null;
    const weight = newIds.length + shifts.length + retired.length;
    if (!weight && !mergedCount && notesThen === notesNow) continue;
    areas.push({
      id,
      title: id === null ? "Elsewhere" : (areaTitle.get(id) ?? id),
      notesThen,
      notesNow,
      newCount: newIds.length,
      changedCount: shifts.length,
      retiredCount: retired.length,
      mergedCount,
      ...(versions ? { versions } : {}),
      newClaims: newIds.slice(0, MAX_NEW_CLAIMS).map((n) => claimOf(f, n)),
      changedClaims: shifts.slice(0, MAX_CHANGED_CLAIMS),
      retiredClaims: retired.slice(0, MAX_RETIRED_CLAIMS).map((n) => claimOf(f, n, true)),
      weight: weight + Math.abs(notesNow - notesThen),
    });
  }
  areas.sort((a, b) => (a.id === null ? 1 : 0) - (b.id === null ? 1 : 0) || b.weight - a.weight || a.title.localeCompare(b.title));
  return { growth, areas: areas.map(({ weight: _w, ...a }) => a) };
}

/**
 * The scope's claims as the vault held them at `since` versus now: then =
 * notes that existed, were live and not yet superseded, with their
 * then-titles; now = live notes nobody has superseded. Notes that changed
 * lead each side (that is the contrast), then the most connected.
 */
export function buildThenVsNow(f: Facts, s: StoryContext): ThenVsNow {
  const incoming = (id: string) => s.nodes.get(id)?.incoming ?? 0;
  const notes = [...s.nodes.keys()].filter((id) => f.isNote(id) && f.inScope(id));
  const order = (lead: (id: string) => boolean) => (a: string, b: string) =>
    Number(lead(b)) - Number(lead(a)) || incoming(b) - incoming(a) || a.localeCompare(b);
  // A merged twin is housekeeping: off both sides, and its survivor is not "changed" by it.
  const mergedInto = new Set(f.merged.values());
  const changedThen = (id: string) => f.shifts.has(id) || f.retired.has(id) || (f.supersededInWindow.has(id) && !f.merged.has(id));
  const changedNow = (id: string) => f.shifts.has(id) || f.created.has(id) || f.shiftReplacements.has(id) || (f.replacements.has(id) && !mergedInto.has(id));
  const supersededBefore = (id: string) => s.superseded.has(id) && !f.supersededInWindow.has(id);
  // A note created in the window and revised since holds its first recorded claim on the then side.
  const thenIds = notes.filter((id) => !f.merged.has(id) && ((f.liveThen(id) && !supersededBefore(id)) || f.firstAt.has(id)));
  const nowIds = new Set(notes.filter((id) => f.liveNow(id) && !s.superseded.has(id) && !f.supersededInWindow.has(id)));
  // Held then and now in the same words: say it once.
  const same = new Set(thenIds.filter((id) => nowIds.has(id) && !differs(f.thenOf(id), f.nowOf(id))));
  const then = thenIds
    .filter((id) => !same.has(id))
    .sort(order(changedThen))
    .slice(0, MAX_THEN_VS_NOW)
    .map((id) => claimOf(f, id, true));
  const now = [...nowIds]
    .filter((id) => !same.has(id))
    .sort(order(changedNow))
    .slice(0, MAX_THEN_VS_NOW)
    .map((id) => claimOf(f, id));
  const unchanged = [...same]
    .sort(order(() => false))
    .slice(0, MAX_THEN_VS_NOW)
    .map((id) => claimOf(f, id));
  return { then, now, unchanged };
}
