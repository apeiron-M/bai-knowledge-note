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
}

export interface Claim {
  documentId: string;
  claim: string;
  gist: string | null;
}

export interface Shift {
  documentId: string;
  then: { claim: string; gist: string | null };
  now: { claim: string; gist: string | null };
  why: string | null;
  replacedBy?: string;
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
  newClaims: Claim[];
  changedClaims: Shift[];
  retiredClaims: Claim[];
}

export interface ChangeStory {
  growth: {
    notesThen: number;
    notesNow: number;
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

/** A document's title and description at `since`, where a baseline recorded them. */
export type ThenFields = Map<string, { title: string | null; description: string | null }>;

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

/** A claim's words, lowercased, without punctuation, stopwords or a plural "s". */
export function claimTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!w || STOPWORDS.has(w)) continue;
    out.add(w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
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

/** A SUPERSEDES reason that says the two notes were one claim written twice. */
const DUPLICATE_REASON = /twin|duplicate|same claim|already makes this claim|merged/i;
/** At or above this title similarity, a supersession is a duplicate merge. */
export const MERGE_SIMILARITY = 0.6;

/**
 * A supersession that merged twin notes (spec Addendum B3): the claims read
 * near-identically, or the reason says so. Not a change in understanding.
 */
export function isDuplicateMerge(then: string, now: string, reason: string | null): boolean {
  return (reason !== null && DUPLICATE_REASON.test(reason)) || claimSimilarity(then, now) >= MERGE_SIMILARITY;
}

function differs(a: { claim: string; gist: string | null }, b: { claim: string; gist: string | null }): boolean {
  return a.claim !== b.claim || (a.gist ?? "") !== (b.gist ?? "");
}

/** What buildStory and buildThenVsNow both read, computed once per digest by {@link storyFacts}. */
export interface Facts {
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
        shifts.set(e.documentId, { documentId: e.documentId, then, now, why: e.supersededBy.reason, replacedBy: e.supersededBy.documentId });
      }
    } else if (e.kind === "revised" && !shifts.has(e.documentId) && !merged.has(e.documentId) && (e.fields?.title || e.fields?.description)) {
      const then = thenOf(e.documentId);
      const now = nowOf(e.documentId);
      if (differs(then, now)) shifts.set(e.documentId, { documentId: e.documentId, then, now, why: e.revisionNotes?.length ? e.revisionNotes.join("; ") : null });
    }
  }
  // Retired: archived in the window, still archived, and replaced by nothing — ever.
  const retired = new Set(
    [...archivedInWindow].filter((id) => isNote(id) && inScope(id) && archivedNow(id) && !supersededInWindow.has(id) && !s.superseded.has(id)),
  );
  const shiftReplacements = new Set([...shifts.values()].flatMap((sh) => (sh.replacedBy ? [sh.replacedBy] : [])));
  return { areas, areasByDoc, created, createdAt, archivedInWindow, supersededInWindow, replacements, shiftReplacements, shifts, merged, retired, inScope, thenOf, nowOf, isNote, liveThen, liveNow };
}

const claimOf = (f: Facts, id: string, then = false): Claim => ({ documentId: id, ...(then ? f.thenOf(id) : f.nowOf(id)) });

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
  const changedThen = (id: string) => f.shifts.has(id) || f.retired.has(id) || f.supersededInWindow.has(id);
  const changedNow = (id: string) => f.shifts.has(id) || f.created.has(id) || f.replacements.has(id);
  const supersededBefore = (id: string) => s.superseded.has(id) && !f.supersededInWindow.has(id);
  const thenIds = notes.filter((id) => f.liveThen(id) && !supersededBefore(id));
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
