import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";
import { kindLabel, noteSourceDocument, plural, topicSize, type SourceDocument } from "./vault-lookups.js";

/**
 * The Ctrl K palette's search (design: docs/design/vault-view, "Ctrl K"):
 * notes and topics from the graph index, sources from the drive tree, chats
 * from the browser's store, and the places to go. Pure and local — every
 * keystroke answers at once. A moment later the server's semantic search
 * answers too (`PaletteSemantic`), and its closest notes and maps, in its
 * order, become the "Best matches" — what the search page lists first;
 * "Search all notes" opens the full list.
 */

export type GotoKey =
  | "add-sources"
  | "new-chat"
  | "new-project"
  | "new-scope"
  | "vault-settings"
  | "processing-queue";

/** The design's "Go to" list, in its order. */
export const GOTO_ROWS: readonly { goto: GotoKey; title: string }[] = [
  { goto: "add-sources", title: "Add sources" },
  { goto: "new-chat", title: "New chat" },
  { goto: "new-project", title: "New project" },
  { goto: "new-scope", title: "New scope of work" },
  { goto: "vault-settings", title: "Vault settings" },
  { goto: "processing-queue", title: "Processing queue" },
];

export type PaletteRow =
  | { kind: "ask"; key: string; query: string }
  | { kind: "note"; key: string; id: string; title: string; detail: string | null }
  | { kind: "topic"; key: string; id: string; title: string; detail: string }
  | { kind: "source"; key: string; document: SourceDocument; title: string; detail: string }
  | { kind: "chat"; key: string; id: string; title: string; detail: string | null }
  | { kind: "more"; key: string; query: string }
  | { kind: "goto"; key: string; goto: GotoKey; title: string };

export type PaletteGroup = { key: string; heading: string | null; rows: PaletteRow[] };

export type PaletteChat = { id: string; title: string; updatedAt: string };

export type PaletteData = {
  notes: readonly KnowledgeNoteInfo[];
  /** note id → its topic (`noteTopicIndex`) */
  topicOf: ReadonlyMap<string, MocInfo>;
  /** source id → its original (`sourceDocuments().bySource`) */
  sourceOf: ReadonlyMap<string, SourceDocument>;
  /** Largest first (`rankedTopics`). */
  topics: readonly MocInfo[];
  /** The overview, listed as "<name> overview" when asked for. */
  hub?: MocInfo;
  sources: readonly SourceDocument[];
  /** original id → notes it gave (`notesPerSourceDocument`) */
  notesPerSource: ReadonlyMap<string, number>;
  /** Newest first. */
  chats: readonly PaletteChat[];
  /** "12m ago", for a chat's right side. */
  ago?: (iso: string) => string;
};

/** A note or map the server's semantic search ranked for a query, closest first. */
export type PaletteSemanticHit = { id: string; title: string; kind: "note" | "moc" };

/** The server's answer to one query; the palette uses it only while that query is still the one typed. */
export type PaletteSemantic = { query: string; hits: readonly PaletteSemanticHit[] };

/** What the palette needs from one server search result. */
export type SemanticResult = {
  documentId: string;
  title: string | null;
  status: string | null;
  matchedBy?: readonly string[];
};

/**
 * The server's results as the palette uses them, or null when they rank by
 * words alone: where the server has no embeddings (the browser vault, an
 * older deployment) it falls back to keyword search, and the palette's own
 * word matching already does that, instantly. Scopes of work and work
 * breakdowns are left to the search page.
 */
export function paletteSemanticFrom(query: string, results: readonly SemanticResult[] | null): PaletteSemantic | null {
  if (!results || !results.some((r) => r.matchedBy?.includes("semantic"))) return null;
  const hits: PaletteSemanticHit[] = [];
  for (const r of results) {
    if (r.status === "SCOPE" || r.status === "WBS") continue;
    hits.push({ id: r.documentId, title: r.title ?? r.documentId, kind: r.status === "MOC" ? "moc" : "note" });
  }
  return { query: query.trim(), hits };
}

/** How many rows each group shows (design: Notes 4, Topics 2, Sources 2). */
export const PALETTE_LIMITS = { notes: 4, topics: 2, sources: 2, chats: 2, recentChats: 3 } as const;

const DASHES = /[‐-―−﹘﹣－]/g;
const APOSTROPHES = /[‘’‚‛′`´]/g;
const QUOTES = /[“”„‟″]/g;
const MARKS = /\p{M}+/gu;

/**
 * Text as the palette compares it: lower case, accents dropped, every dash
 * a hyphen and every quote a straight one — so "large-frame" finds the
 * note written "large‑frame" (U+2011), and "dao" finds "DAO".
 */
export function foldText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(MARKS, "")
    .replace(DASHES, "-")
    .replace(APOSTROPHES, "'")
    .replace(QUOTES, '"')
    .toLowerCase();
}

/** The words of a query, folded; empty for a blank one. */
export function queryTerms(query: string): string[] {
  return foldText(query).split(/\s+/).filter(Boolean);
}

/** A word is found anywhere in the text; a plural ("turbines") also finds its singular. */
function hasTerm(text: string, term: string): boolean {
  if (text.includes(term)) return true;
  return term.length > 3 && term.endsWith("s") && !term.endsWith("ss") && text.includes(term.slice(0, -1));
}

/** Every word of the query is in the (folded) text, in any order. */
export function matchesTerms(text: string, terms: readonly string[]): boolean {
  return terms.every((term) => hasTerm(text, term));
}

/**
 * How well a title answers: every word in the title beats words spread over
 * the description; the whole phrase at the start of the title beats it
 * anywhere. Null when the text does not match at all.
 */
function rank(title: string, rest: string, terms: readonly string[], phrase: string): number | null {
  if (!matchesTerms(`${title} ${rest}`, terms)) return null;
  let score = 0;
  if (matchesTerms(title, terms)) score += 4;
  if (title.startsWith(phrase)) score += 2;
  else if (title.includes(phrase)) score += 1;
  return score;
}

type Ranked<T> = { item: T; score: number; order: number };

function byRank<T>(a: Ranked<T>, b: Ranked<T>): number {
  return b.score - a.score || a.order - b.order;
}

const noteTime = (n: KnowledgeNoteInfo) => n.provenance?.createdAt ?? n.provenance?.updatedAt ?? "";

/**
 * What the palette searches: everything (Ctrl K, Search), or only the chats
 * (the sidebar's "All chats").
 */
export type PaletteScope = "all" | "chats";

/** The palette's groups for a query; an empty query shows what is newest and largest, and where to go. */
export function paletteGroups(
  query: string,
  data: PaletteData,
  scope: PaletteScope = "all",
  semantic: PaletteSemantic | null = null,
): PaletteGroup[] {
  const terms = queryTerms(query);
  const phrase = terms.join(" ");
  const typed = terms.length > 0;
  // An answer for what was typed before is not an answer for this.
  const meaning = semantic && semantic.query === query.trim() ? semantic.hits : [];
  const groups: PaletteGroup[] = [];
  const add = (key: string, heading: string | null, rows: PaletteRow[]) => {
    if (rows.length > 0) groups.push({ key, heading, rows });
  };

  if (scope === "chats") {
    // Every chat this vault keeps, newest first; the words narrow them.
    const chats = typed ? data.chats.filter((c) => matchesTerms(foldText(c.title), terms)) : data.chats;
    add(
      "chats",
      "Chats",
      chats.map((c) => ({ kind: "chat", key: `chat:${c.id}`, id: c.id, title: c.title, detail: data.ago ? data.ago(c.updatedAt) : null })),
    );
    const newChat = GOTO_ROWS.filter((g) => g.goto === "new-chat" && (!typed || matchesTerms(foldText(g.title), terms)));
    add("goto", "Go to", newChat.map((g) => ({ kind: "goto", key: `goto:${g.goto}`, goto: g.goto, title: g.title })));
    return groups;
  }

  if (typed) add("ask", null, [{ kind: "ask", key: "ask", query: query.trim() }]);

  // Maps as the palette lists them: every map by its title, the overview as "<name> overview".
  const topicRow = (m: MocInfo, title = m.title): PaletteRow => ({
    kind: "topic",
    key: `topic:${m.id}`,
    id: m.id,
    title,
    detail: topicSize(m),
  });
  const candidates: { moc: MocInfo; title: string }[] = [
    ...data.topics.map((m) => ({ moc: m, title: m.title })),
    ...(data.hub ? [{ moc: data.hub, title: `${data.hub.title} overview` }] : []),
  ];
  const known = new Map(candidates.map((c) => [c.moc.id, c]));
  /** Maps already shown among the best matches, so Topics does not repeat them. */
  const shown = new Set<string>();

  // Notes: newest first, then by how well they answer.
  const newest = [...data.notes].sort((a, b) => noteTime(b).localeCompare(noteTime(a)));
  const noteRow = (n: KnowledgeNoteInfo): PaletteRow => ({
    kind: "note",
    key: `note:${n.id}`,
    id: n.id,
    title: n.title ?? n.name,
    detail:
      noteSourceDocument(n, data.sourceOf)?.name ?? data.topicOf.get(n.id)?.title ?? kindLabel(n.noteType),
  });
  // The server's answer, in its order, notes and maps together — what the
  // search page lists first. Maps the palette does not list are left out.
  const byId = new Map(data.notes.map((n) => [n.id, n]));
  const best = meaning.flatMap((h): PaletteRow[] => {
    if (h.kind === "note") {
      const n = byId.get(h.id);
      return [n ? noteRow(n) : { kind: "note", key: `note:${h.id}`, id: h.id, title: h.title, detail: null }];
    }
    const c = known.get(h.id);
    return c ? [topicRow(c.moc, c.title)] : [];
  });
  if (typed && best.length > 0) {
    const rows = best.slice(0, PALETTE_LIMITS.notes);
    for (const r of rows) if (r.kind === "topic") shown.add(r.id);
    rows.push({ kind: "more", key: "more", query: query.trim() });
    add("notes", "Best matches", rows);
  } else if (typed) {
    // Until the server answers (or where it ranks by words alone): the palette's own word matches.
    const hits: Ranked<KnowledgeNoteInfo>[] = [];
    newest.forEach((n, order) => {
      const rest = [n.description ?? "", data.topicOf.get(n.id)?.title ?? "", ...n.topics.map((t) => t.name)].join(" ");
      const score = rank(foldText(n.title ?? n.name), foldText(rest), terms, phrase);
      if (score !== null) hits.push({ item: n, score, order });
    });
    hits.sort(byRank);
    const rows = hits.slice(0, PALETTE_LIMITS.notes).map((h) => noteRow(h.item));
    // The server's semantic search finds what the words alone do not —
    // once there are notes for it to search.
    if (data.notes.length > 0) rows.push({ kind: "more", key: "more", query: query.trim() });
    add("notes", "Notes", rows);
  } else {
    add("notes", "Notes", newest.slice(0, PALETTE_LIMITS.notes).map(noteRow));
  }

  // Topics: the largest first; the overview only when asked for.
  if (typed) {
    const hits: Ranked<{ moc: MocInfo; title: string }>[] = [];
    candidates.forEach((c, order) => {
      const score = rank(foldText(c.title), foldText(c.moc.description ?? ""), terms, phrase);
      if (score !== null) hits.push({ item: c, score, order });
    });
    hits.sort(byRank);
    const rest = hits.filter((h) => !shown.has(h.item.moc.id));
    add("topics", "Topics", rest.slice(0, PALETTE_LIMITS.topics).map((h) => topicRow(h.item.moc, h.item.title)));
  } else {
    add("topics", "Topics", data.topics.slice(0, PALETTE_LIMITS.topics).map((m) => topicRow(m)));
  }

  // Sources: the originals, by name; the ones that gave the most notes first.
  const notesOf = (d: SourceDocument) => data.notesPerSource.get(d.id) ?? 0;
  const bySize = [...data.sources].sort((a, b) => notesOf(b) - notesOf(a) || a.name.localeCompare(b.name));
  const sourceRow = (d: SourceDocument): PaletteRow => ({
    kind: "source",
    key: `source:${d.id}`,
    document: d,
    title: d.name,
    detail:
      notesOf(d) > 0
        ? plural(notesOf(d), "note")
        : d.kind === "folder"
          ? plural(d.sourceIds.length, "section")
          : "No notes yet",
  });
  if (typed) {
    const hits: Ranked<SourceDocument>[] = [];
    bySize.forEach((d, order) => {
      const score = rank(foldText(d.name), foldText(d.fileName), terms, phrase);
      if (score !== null) hits.push({ item: d, score, order });
    });
    hits.sort(byRank);
    add("sources", "Sources", hits.slice(0, PALETTE_LIMITS.sources).map((h) => sourceRow(h.item)));
  } else {
    add("sources", "Sources", bySize.slice(0, PALETTE_LIMITS.sources).map(sourceRow));
  }

  // Chats: what you asked, newest first.
  const chatRow = (c: PaletteChat): PaletteRow => ({
    kind: "chat",
    key: `chat:${c.id}`,
    id: c.id,
    title: c.title,
    detail: data.ago ? data.ago(c.updatedAt) : null,
  });
  if (typed) {
    const hits = data.chats.filter((c) => matchesTerms(foldText(c.title), terms));
    add("chats", "Chats", hits.slice(0, PALETTE_LIMITS.chats).map(chatRow));
  } else {
    add("chats", "Recent chats", data.chats.slice(0, PALETTE_LIMITS.recentChats).map(chatRow));
  }

  // Go to: all of it while nothing is typed; what the words name once they are.
  const gotos = typed ? GOTO_ROWS.filter((g) => matchesTerms(foldText(g.title), terms)) : GOTO_ROWS;
  add(
    "goto",
    "Go to",
    gotos.map((g) => ({ kind: "goto", key: `goto:${g.goto}`, goto: g.goto, title: g.title })),
  );

  return groups;
}

/** The rows in the order ↑ and ↓ walk them. */
export function paletteRows(groups: readonly PaletteGroup[]): PaletteRow[] {
  return groups.flatMap((g) => g.rows);
}

/** The row `delta` steps away, wrapping at both ends. */
export function stepRow(count: number, current: number, delta: number): number {
  if (count === 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (((current + delta) % count) + count) % count;
}
