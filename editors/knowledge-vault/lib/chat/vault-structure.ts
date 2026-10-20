/**
 * Shaping the vault's structure for the chat: where an exact phrase appears,
 * how the maps of content hang together, and which contradictions are open.
 *
 * The graph answers each of these with rows; what the model needs is the
 * shape — a snippet instead of a 6,000-character body, a hierarchy instead of
 * an edge list, the two notes a contradiction is between instead of an id.
 * Pure, so it is tested without a network; vault-tools.ts does the fetching.
 */

/* ------------------------------------------------------------------ */
/*  Exact text                                                        */
/* ------------------------------------------------------------------ */

/** How much text either side of a match the snippet keeps. */
const SNIPPET_RADIUS = 110;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The words of a query as matching sees them: lower case, quotes and
 * surrounding punctuation dropped. "\"Gas turbine\" backlog?" → gas, turbine, backlog.
 */
export function queryWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((w) => w.length > 0);
}

/** The phrase as the index matches it: the query, lower-cased, quotes removed. */
export function queryPhrase(query: string): string {
  return squash(query.replace(/["“”]/g, "")).toLowerCase();
}

export interface TextMatch {
  /** Which field the match is in; the title wins over the body. */
  matchedIn: "title" | "description" | "content";
  /** The text around the first match, with "…" where it was cut. */
  snippet: string;
}

/** A window of `text` around [start, end), on word boundaries, with ellipses. */
function windowAround(text: string, start: number, end: number): string {
  let from = Math.max(0, start - SNIPPET_RADIUS);
  let to = Math.min(text.length, end + SNIPPET_RADIUS);
  if (from > 0) {
    const space = text.indexOf(" ", from);
    if (space > -1 && space < start) from = space + 1;
  }
  if (to < text.length) {
    const space = text.lastIndexOf(" ", to);
    if (space > end) to = space;
  }
  return `${from > 0 ? "…" : ""}${squash(text.slice(from, to))}${to < text.length ? "…" : ""}`;
}

/**
 * Where a node matches: the phrase if it appears as written, else the first
 * of the words (when every word appears somewhere). Null when it does not
 * match at all — the index's answer and ours should agree, but a row the
 * index returned for a reason we cannot see is reported, not trusted.
 */
export function findMatch(
  fields: { title?: string | null; description?: string | null; content?: string | null },
  query: string,
): (TextMatch & { match: "phrase" | "all words" }) | null {
  const phrase = queryPhrase(query);
  const order = ["title", "description", "content"] as const;
  for (const f of order) {
    const text = fields[f] ?? "";
    const at = text.toLowerCase().indexOf(phrase);
    if (phrase && at > -1) {
      return {
        matchedIn: f,
        snippet: f === "title" ? squash(text) : windowAround(text, at, at + phrase.length),
        match: "phrase",
      };
    }
  }
  const words = queryWords(query);
  if (words.length < 2) return null;
  const all = order.map((f) => (fields[f] ?? "").toLowerCase()).join("\n");
  if (!words.every((w) => all.includes(w))) return null;
  for (const f of order) {
    const text = fields[f] ?? "";
    const lower = text.toLowerCase();
    const word = words.find((w) => lower.includes(w));
    if (word) {
      const at = lower.indexOf(word);
      return {
        matchedIn: f,
        snippet: f === "title" ? squash(text) : windowAround(text, at, at + word.length),
        match: "all words",
      };
    }
  }
  return null;
}

/** The word most likely to narrow a search: the longest, numbers and acronyms included. */
export function rarestWord(query: string): string | null {
  const words = queryWords(query);
  if (words.length === 0) return null;
  return [...words].sort((a, b) => b.length - a.length)[0];
}

/* ------------------------------------------------------------------ */
/*  Maps of content                                                   */
/* ------------------------------------------------------------------ */

export interface MocNode {
  documentId: string;
  title: string | null;
  description: string | null;
  /** "MOC (HUB)", "MOC (DOMAIN)", "MOC (TOPIC)" as the index writes it. */
  noteType: string | null;
}

/** One map's outgoing membership edges. */
export interface MocLinks {
  /** CHILD_MOC targets: the maps beneath it. */
  children: string[];
  /** CORE_IDEA targets: the notes it holds, with the title the edge carried. */
  notes: { documentId: string; title: string | null }[];
}

export interface TopicMapRow {
  documentId: string;
  title: string;
  documentType: "bai/moc";
  tier: "HUB" | "DOMAIN" | "TOPIC";
  /** Depth in the hierarchy: 0 for a map nothing points at. */
  depth: number;
  /** The map it hangs from; null at the top. */
  parentId: string | null;
  /** Notes this map holds directly. */
  notes: number;
  /** Distinct notes in this map and every map beneath it. */
  notesBeneath: number;
  /** Maps directly beneath it. */
  childMaps: number;
  description: string | null;
}

export interface TopicMap {
  /** Every map, depth-first from the top, each listed once. */
  maps: TopicMapRow[];
  hubs: number;
  /** Maps nothing points at that are not the hub — unreachable from the top. */
  unattached: { documentId: string; title: string }[];
  /** Distinct notes held by any map. */
  notesInMaps: number;
}

export function tierOf(noteType: string | null): "HUB" | "DOMAIN" | "TOPIC" {
  const m = /\((HUB|DOMAIN|TOPIC)\)/i.exec(noteType ?? "");
  return (m?.[1]?.toUpperCase() as "HUB" | "DOMAIN" | "TOPIC" | undefined) ?? "TOPIC";
}

const TIER_ORDER = { HUB: 0, DOMAIN: 1, TOPIC: 2 } as const;
const DESCRIPTION_CHARS = 200;
const shorten = (s: string | null) =>
  !s ? null : s.length > DESCRIPTION_CHARS ? `${s.slice(0, DESCRIPTION_CHARS).trimEnd()}…` : s;

/**
 * The hierarchy as one flat, depth-first list. Flat on purpose: every row
 * carries documentId and title at the same depth, so each map is citable
 * however deep it sits, and a model reads a list more reliably than a tree.
 * A map reachable from two parents is listed once, under the first.
 */
export function buildTopicMap(mocs: MocNode[], links: Map<string, MocLinks>): TopicMap {
  const byId = new Map(mocs.map((m) => [m.documentId, m]));
  const parentsOf = new Map<string, string[]>();
  for (const m of mocs) {
    for (const child of links.get(m.documentId)?.children ?? []) {
      if (!byId.has(child)) continue;
      parentsOf.set(child, [...(parentsOf.get(child) ?? []), m.documentId]);
    }
  }
  const title = (id: string) => byId.get(id)?.title || id;
  const byName = (a: string, b: string) =>
    TIER_ORDER[tierOf(byId.get(a)?.noteType ?? null)] - TIER_ORDER[tierOf(byId.get(b)?.noteType ?? null)] ||
    title(a).localeCompare(title(b), undefined, { numeric: true, sensitivity: "base" });

  const beneathCache = new Map<string, Set<string>>();
  const notesBeneath = (id: string, seen = new Set<string>()): Set<string> => {
    const cached = beneathCache.get(id);
    if (cached) return cached;
    seen.add(id);
    const out = new Set((links.get(id)?.notes ?? []).map((n) => n.documentId));
    for (const child of links.get(id)?.children ?? []) {
      if (!byId.has(child) || seen.has(child)) continue;
      for (const n of notesBeneath(child, seen)) out.add(n);
    }
    beneathCache.set(id, out);
    return out;
  };

  const roots = mocs.map((m) => m.documentId).filter((id) => !parentsOf.has(id)).sort(byName);
  const rows: TopicMapRow[] = [];
  const listed = new Set<string>();
  const visit = (id: string, depth: number, parentId: string | null) => {
    if (listed.has(id)) return;
    listed.add(id);
    const m = byId.get(id)!;
    const l = links.get(id);
    const children = (l?.children ?? []).filter((c) => byId.has(c));
    rows.push({
      documentId: id,
      title: title(id),
      documentType: "bai/moc",
      tier: tierOf(m.noteType),
      depth,
      parentId,
      notes: l?.notes.length ?? 0,
      notesBeneath: notesBeneath(id).size,
      childMaps: children.length,
      description: shorten(m.description),
    });
    for (const c of [...children].sort(byName)) visit(c, depth + 1, id);
  };
  for (const r of roots) visit(r, 0, null);
  // A cycle with no root (A child of B child of A) is still listed.
  for (const m of [...mocs].sort((a, b) => byName(a.documentId, b.documentId))) visit(m.documentId, 0, null);

  const allNotes = new Set<string>();
  for (const l of links.values()) for (const n of l.notes) allNotes.add(n.documentId);
  return {
    maps: rows,
    hubs: rows.filter((r) => r.tier === "HUB").length,
    unattached: rows
      .filter((r) => r.parentId === null && r.tier !== "HUB")
      .map((r) => ({ documentId: r.documentId, title: r.title })),
    notesInMaps: allNotes.size,
  };
}

/** The map a model named: a documentId, an exact title, or a title it is the unique start of. */
export function resolveMap(
  maps: TopicMapRow[],
  raw: string,
): { map: TopicMapRow } | { error: string } {
  const wanted = raw.trim();
  const byId = maps.find((m) => m.documentId === wanted);
  if (byId) return { map: byId };
  const key = wanted.toLowerCase();
  const exact = maps.filter((m) => m.title.toLowerCase() === key);
  if (exact.length === 1) return { map: exact[0] };
  const partial = maps.filter((m) => m.title.toLowerCase().includes(key));
  if (exact.length === 0 && partial.length === 1) return { map: partial[0] };
  const candidates = (exact.length > 1 ? exact : partial).map((m) => m.title);
  if (candidates.length > 1) {
    return { error: `"${raw}" matches ${candidates.length} maps: ${candidates.join("; ")}. Pass one title exactly, or its documentId.` };
  }
  const top = maps.filter((m) => m.depth <= 1).map((m) => m.title);
  return {
    error: `No map of content called "${raw}".${top.length ? ` The top of the hierarchy is: ${top.join("; ")}.` : " This vault has no maps of content yet."}`,
  };
}

/* ------------------------------------------------------------------ */
/*  Contradictions                                                    */
/* ------------------------------------------------------------------ */

export type TensionStatus = "OPEN" | "RESOLVED" | "DISSOLVED";

export interface TensionNode {
  documentId: string;
  title: string | null;
  description: string | null;
  status: string | null;
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ContradictionRow {
  documentId: string;
  title: string;
  documentType: "bai/tension";
  status: TensionStatus;
  /** The notes it is between: usually the two claims. */
  notes: { documentId: string; title: string | null }[];
  /** Both claims in full, as the tension states them. */
  description: string | null;
  openedBy: string | null;
  openedAt: string | null;
  updatedAt: string | null;
}

export function tensionStatus(raw: string | null): TensionStatus {
  const s = (raw ?? "").toUpperCase();
  return s === "RESOLVED" || s === "DISSOLVED" ? s : "OPEN";
}

/** Counts by status, then the rows wanted, open ones newest first. */
export function shapeContradictions(
  tensions: TensionNode[],
  involved: Map<string, { documentId: string; title: string | null }[]>,
  want: TensionStatus | "ALL",
): { counts: Record<TensionStatus, number>; rows: ContradictionRow[] } {
  const counts: Record<TensionStatus, number> = { OPEN: 0, RESOLVED: 0, DISSOLVED: 0 };
  for (const t of tensions) counts[tensionStatus(t.status)]++;
  const rows = tensions
    .filter((t) => want === "ALL" || tensionStatus(t.status) === want)
    .map<ContradictionRow>((t) => ({
      documentId: t.documentId,
      title: t.title || t.documentId,
      documentType: "bai/tension",
      status: tensionStatus(t.status),
      notes: involved.get(t.documentId) ?? [],
      description: t.description,
      openedBy: t.author,
      openedAt: t.createdAt,
      updatedAt: t.updatedAt,
    }))
    .sort(
      (a, b) =>
        Number(b.status === "OPEN") - Number(a.status === "OPEN") ||
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
    );
  return { counts, rows };
}
