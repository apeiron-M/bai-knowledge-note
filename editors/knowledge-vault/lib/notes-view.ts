import { NOTE_LINK_TYPES, isNoteGroup, type SourceTimeline, type TimelineAddition } from "../../../processors/graph-indexer/source-timeline.js";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";
import { hubMap, noteTopicIndex, sourceDocuments, type TreeNodeLike } from "./vault-lookups.js";
import { kindWord } from "./timeline/additions.js";

/**
 * The Notes page (design: docs/design/notes-view, option D): every note beside
 * the source it came from, or inside the topic it sits in. Pure, and built from
 * what the vault already holds — the graph projection, the drive tree and the
 * source timeline — so the page costs no request of its own.
 */

/** A link between two notes, seen from one of them. */
export type NoteLink = { other: string; type: string; reason: string | null; dir: "out" | "in" };

/** One part of a source (a chapter, a section) and the notes taken from it. */
export type NotesPart = { id: string; title: string; noteIds: string[] };

export type NotesSource = {
  /** The original: its folder under /sources, or the source itself when it came in whole. */
  id: string;
  name: string;
  /** What Open source opens; `none` is the group of notes no source records. */
  kind: "folder" | "source" | "none";
  /** "Book", "PDF", "Email"… — null when the timeline is not known yet. */
  label: string | null;
  /** What one part is called: chapter, section, message, part. */
  partWord: string;
  addedAt: string | null;
  lastAddedAt: string | null;
  /** The timeline addition Graph › Over time lights for it. */
  additionId: string | null;
  /** Parts that gave notes, in the document's order. */
  parts: NotesPart[];
  /** Parts that gave none, named so nothing seems lost. */
  emptyParts: NotesPart[];
  partCount: number;
  /** Its notes, part by part. */
  noteIds: string[];
};

export type NotesTopic = { moc: MocInfo; noteIds: string[] };

/** A top-level map (an area of topics, or a topic on its own), or the notes in no topic. */
export type NotesTopicGroup = {
  /** null: the notes no topic holds yet. */
  moc: MocInfo | null;
  /** Subtopics with notes, largest first. Empty for a topic on its own. */
  subtopics: NotesTopic[];
  emptySubtopics: MocInfo[];
  /** Its own notes and its subtopics', once each. */
  noteIds: string[];
};

export type NotesIndex = {
  byId: Map<string, KnowledgeNoteInfo>;
  /** Links between notes, both directions, by note. */
  links: Map<string, NoteLink[]>;
  sourceOf: Map<string, NotesSource>;
  partOf: Map<string, NotesPart>;
  /** Where in its part a note's claim was found (its DERIVED_FROM reason). */
  passageOf: Map<string, string>;
  /** The narrowest topic holding each note. */
  topicOf: Map<string, MocInfo>;
  /** Newest first; the notes with no recorded source last. */
  sources: NotesSource[];
  topics: NotesTopicGroup[];
  /** Every map but the overview, as the sidebar counts them. */
  topicCount: number;
  /** What a search reads, lowercased, by note: built once, not on every keystroke. */
  searchText: Map<string, string>;
};

export type NotesViewInput = {
  notes: readonly KnowledgeNoteInfo[];
  mocs: readonly MocInfo[];
  /** The drive tree: folders and files. */
  tree: readonly TreeNodeLike[];
  /** The source timeline, for document order, kinds and dates; the page works without it. */
  timeline?: SourceTimeline | null;
};

/** The id of the group of notes no source records. */
export const UNSOURCED = "notes:unsourced";

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export function buildNotesIndex({ notes, mocs, tree, timeline }: NotesViewInput): NotesIndex {
  const byId = new Map(notes.map((n) => [n.id, n] as const));
  const links = new Map<string, NoteLink[]>();
  const add = (id: string, l: NoteLink) => {
    const list = links.get(id);
    if (list) list.push(l);
    else links.set(id, [l]);
  };
  for (const n of notes) {
    for (const l of n.links) {
      const to = l.targetDocumentId;
      if (!to || to === n.id || !byId.has(to) || !NOTE_LINK_TYPES.has(l.linkType ?? "")) continue;
      const type = l.linkType ?? "RELATES_TO";
      add(n.id, { other: to, type, reason: l.reason, dir: "out" });
      add(to, { other: n.id, type, reason: l.reason, dir: "in" });
    }
  }
  const rank = (a: string, b: string) => rankOrder(byId, links, a, b);

  // Parts in the order they arrived, and the addition each belongs to.
  const arrival = new Map<string, { addition: TimelineAddition; at: number; i: number }>();
  for (const a of timeline?.additions ?? []) {
    if (isNoteGroup(a)) continue;
    a.sourceIds.forEach((id, i) => arrival.set(id, { addition: a, at: time(a.addedAt), i }));
  }

  const originals = sourceDocuments(tree);
  const names = new Map(tree.map((n) => [n.id, n.name] as const));
  const partOf = new Map<string, NotesPart>();
  const sourceOf = new Map<string, NotesSource>();
  const passageOf = new Map<string, string>();
  const partNotes = new Map<string, string[]>();
  const unsourced: string[] = [];
  for (const n of notes) {
    const link = n.links.find((l) => l.linkType === "DERIVED_FROM" && l.targetDocumentId && originals.bySource.has(l.targetDocumentId));
    const part = link?.targetDocumentId;
    if (!part) {
      unsourced.push(n.id);
      continue;
    }
    const list = partNotes.get(part);
    if (list) list.push(n.id);
    else partNotes.set(part, [n.id]);
    const where = passageText(link.reason);
    if (where) passageOf.set(n.id, where);
  }

  const sources: NotesSource[] = [];
  for (const doc of originals.documents) {
    const parts = doc.sourceIds.map<NotesPart>((id) => ({
      id,
      title: doc.kind === "source" ? doc.name : partTitle(names.get(id) ?? id, doc.name),
      noteIds: (partNotes.get(id) ?? []).sort(rank),
    }));
    if (!parts.some((p) => p.noteIds.length)) continue;
    parts.sort((a, b) => {
      const x = arrival.get(a.id), y = arrival.get(b.id);
      if (x && y) return x.at - y.at || x.i - y.i;
      if (x || y) return x ? -1 : 1;
      return byName(a.title, b.title);
    });
    const additions = [...new Set(doc.sourceIds.map((id) => arrival.get(id)?.addition).filter((a): a is TimelineAddition => !!a))].sort((a, b) => time(a.addedAt) - time(b.addedAt));
    const first = additions.at(0);
    const last = additions.at(-1);
    const { label, partWord } = sourceLabel(first);
    const source: NotesSource = {
      id: doc.id,
      name: doc.name,
      kind: doc.kind,
      label,
      partWord,
      addedAt: first?.addedAt ?? null,
      lastAddedAt: last ? last.lastAddedAt || last.addedAt : null,
      additionId: last?.id ?? null,
      parts: parts.filter((p) => p.noteIds.length),
      emptyParts: parts.filter((p) => !p.noteIds.length),
      partCount: parts.length,
      noteIds: parts.flatMap((p) => p.noteIds),
    };
    for (const p of source.parts) for (const id of p.noteIds) {
      sourceOf.set(id, source);
      partOf.set(id, p);
    }
    sources.push(source);
  }
  // Newest first, by the last time anything arrived; without a timeline, by the newest note.
  const newest = (s: NotesSource) => time(s.lastAddedAt) || Math.max(0, ...s.noteIds.map((id) => time(byId.get(id)?.provenance?.createdAt)));
  sources.sort((a, b) => newest(b) - newest(a) || byName(a.name, b.name));
  if (unsourced.length) {
    const ids = unsourced.sort(rank);
    const part: NotesPart = { id: UNSOURCED, title: "", noteIds: ids };
    sources.push({ id: UNSOURCED, name: "Notes with no source", kind: "none", label: null, partWord: "part", addedAt: null, lastAddedAt: null, additionId: null, parts: [part], emptyParts: [], partCount: 0, noteIds: ids });
  }

  // Topics: the overview's maps, or — without an overview — every map no other map holds.
  const topicOf = noteTopicIndex(mocs);
  const mocById = new Map(mocs.map((m) => [m.id, m] as const));
  const hub = hubMap(mocs);
  const heldByMap = new Set(mocs.filter((m) => m !== hub).flatMap((m) => m.childRefs));
  const top = mocs.filter((m) => m !== hub && !heldByMap.has(m.id));
  const notesOf = (m: MocInfo) => [...new Set(m.coreIdeas.map((c) => c.noteRef).filter((id) => byId.has(id)))];
  const topics: NotesTopicGroup[] = [];
  for (const m of top) {
    const subs = m.childRefs.map((id) => mocById.get(id)).filter((c): c is MocInfo => !!c && c !== hub);
    const subtopics = subs.map((c) => ({ moc: c, noteIds: notesOf(c).sort(rank) })).filter((t) => t.noteIds.length).sort((a, b) => b.noteIds.length - a.noteIds.length || byName(a.moc.title, b.moc.title));
    const noteIds = [...new Set([...notesOf(m), ...subtopics.flatMap((t) => t.noteIds)])].sort(rank);
    if (!noteIds.length) continue;
    topics.push({ moc: m, subtopics, emptySubtopics: subs.filter((c) => !notesOf(c).length), noteIds });
  }
  topics.sort((a, b) => Number(b.subtopics.length > 0) - Number(a.subtopics.length > 0) || b.noteIds.length - a.noteIds.length || byName(a.moc?.title ?? "", b.moc?.title ?? ""));
  const loose = notes.filter((n) => !topicOf.has(n.id)).map((n) => n.id).sort(rank);
  if (loose.length) topics.push({ moc: null, subtopics: [], emptySubtopics: [], noteIds: loose });

  const searchText = new Map<string, string>();
  for (const n of notes) {
    searchText.set(n.id, [n.title ?? n.name, n.description ?? "", topicOf.get(n.id)?.title ?? "", sourceOf.get(n.id)?.name ?? ""].join(" ").toLowerCase());
  }
  return { byId, links, sourceOf, partOf, passageOf, topicOf, sources, topics, topicCount: mocs.filter((m) => m !== hub).length, searchText };
}

function rankOrder(byId: Map<string, KnowledgeNoteInfo>, links: Map<string, NoteLink[]>, a: string, b: string): number {
  const la = links.get(a) ?? [], lb = links.get(b) ?? [];
  return lb.length - la.length || lb.filter((l) => l.dir === "in").length - la.filter((l) => l.dir === "in").length || (byId.get(a)?.title ?? "").localeCompare(byId.get(b)?.title ?? "");
}

/** How many notes a note is linked to, either way. */
export function degree(index: NotesIndex, id: string): number {
  return index.links.get(id)?.length ?? 0;
}

/** Most connected first. */
export function rankNotes(index: NotesIndex, ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => rankOrder(index.byId, index.links, a, b));
}

/** A group's most connected notes: what its key ideas are. */
export function keyIdeas(index: NotesIndex, ids: readonly string[], k = 3): string[] {
  return rankNotes(index, ids).slice(0, k);
}

/** The topics some notes went into, largest first. */
export function topicsFed(index: NotesIndex, ids: readonly string[]): { moc: MocInfo; count: number }[] {
  const counts = new Map<MocInfo, number>();
  for (const id of ids) {
    const m = index.topicOf.get(id);
    if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return [...counts].map(([moc, count]) => ({ moc, count })).sort((a, b) => b.count - a.count || a.moc.title.localeCompare(b.moc.title));
}

/** Which sources some notes came from, largest first. */
export function sourcesOf(index: NotesIndex, ids: readonly string[]): { source: NotesSource; count: number }[] {
  const counts = new Map<NotesSource, number>();
  for (const id of ids) {
    const s = index.sourceOf.get(id);
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count || a.source.name.localeCompare(b.source.name));
}

/** Links from a source's notes to other sources' notes, by the other source: the vault compounding. */
export function crossSourceLinks(index: NotesIndex, source: NotesSource): { source: NotesSource; count: number }[] {
  const counts = new Map<NotesSource, number>();
  for (const id of source.noteIds) {
    for (const l of index.links.get(id) ?? []) {
      const other = index.sourceOf.get(l.other);
      if (other && other !== source) counts.set(other, (counts.get(other) ?? 0) + 1);
    }
  }
  return [...counts].map(([s, count]) => ({ source: s, count })).sort((a, b) => b.count - a.count || a.source.name.localeCompare(b.source.name));
}

/** In review or a draft: not approved yet. */
export function needsReview(note: Pick<KnowledgeNoteInfo, "status">): boolean {
  return note.status === "IN_REVIEW" || note.status === "DRAFT";
}

/** The words of a search, lowercased; empty for no search. */
export function searchWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Whether every word is in the note's claim, description, topic or source. */
export function noteMatches(index: NotesIndex, note: KnowledgeNoteInfo, words: readonly string[]): boolean {
  if (!words.length) return true;
  const hay = index.searchText.get(note.id) ?? [note.title ?? note.name, note.description ?? ""].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The review states in a reader's words; an approved note says nothing. */
export const STATUS_WORDS: Record<string, string> = { IN_REVIEW: "Waiting for review", DRAFT: "Draft", ARCHIVED: "Archived" };

/** What each kind of note is, said once where kinds are picked. */
export const KIND_HELP: Record<string, string> = {
  OBSERVATION: "something the source reports or measured",
  CONCEPT: "an idea or a definition",
  PATTERN: "something that recurs, and when it applies",
  DECISION: "a choice, and why it was made",
  ARCHITECTURE: "how a system is put together",
  PROCEDURE: "steps to follow",
  BUG_PATTERN: "a known way things go wrong",
  REFERENCE: "facts to look up",
  INTEGRATION: "how two systems connect",
  WORKFLOW: "how work moves from step to step",
};

/** A link's type from either end: "Builds on" from the note that builds, "Built on by" from the one built on. */
export const LINK_WORDS: Record<string, [string, string]> = {
  BUILDS_ON: ["Builds on", "Built on by"],
  RELATES_TO: ["Relates to", "Related to"],
  CONTRADICTS: ["Contradicts", "Contradicted by"],
  SUPERSEDES: ["Replaces", "Replaced by"],
};

/** Where in its part a claim was found, without the part's own name: `Extracted from "Overview": Overview, paragraph 1` → `Overview, paragraph 1`. */
export function passageText(reason: string | null | undefined): string | null {
  const r = (reason ?? "").replace(/^Extracted from\s*"[^"]*":\s*/i, "").replace(/^Extracted from\s*/i, "").trim();
  return r || null;
}

const capital = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const words = (s: string) => capital(s.replace(/[-_]+/g, " ").trim());

/**
 * A part's name as a reader would write it, from its name in the drive:
 * the original's name is not repeated ("$100M Money Models: How To Make Money - Anchor Upsell" → "Anchor Upsell"),
 * a slug reads as words ("03-ch01-the-six-minds-of-experience" → "Ch. 01: The six minds of experience"),
 * a numbered split says its number ("report.pdf · part 9" → "Part 9"), and shouting is lowered.
 */
export function partTitle(name: string, original: string): string {
  let t = name.trim();
  const head = original.split(/[:—–]| - /).at(0)?.trim() ?? "";
  if (head && t.toLowerCase().startsWith(head.toLowerCase())) {
    const m = /^.*?(?: - | — | – )(.+)$/.exec(t);
    if (m) t = m[1].trim();
  }
  const numbered = /· part (\d+)$/i.exec(t);
  if (numbered) return `Part ${numbered[1]}`;
  if (!/\s/.test(t) && /[-_]/.test(t)) {
    const s = t.replace(/^\d+[-_]/, "");
    const ch = /^ch(?:apter)?[-_]?(\d+)[-_](.+)$/i.exec(s);
    if (ch) return `Ch. ${ch[1]}: ${words(ch[2])}`;
    const pt = /^part[-_]([ivxlc]+|\d+)[-_](.+)$/i.exec(s);
    if (pt) return `Part ${pt[1].toUpperCase()}: ${words(pt[2])}`;
    return words(s) || name;
  }
  if (t === t.toUpperCase() && /[A-Z]{3}/.test(t)) t = capital(t.toLowerCase());
  return t || name;
}

/** What a source is ("Book", "PDF") and what its parts are called, from its timeline addition. */
export function sourceLabel(a: TimelineAddition | undefined): { label: string | null; partWord: string } {
  if (!a) return { label: null, partWord: "part" };
  const type = a.sourceType ?? "";
  const mime = a.mimeType ?? "";
  if (type === "BOOK_CHAPTER" || mime === "application/epub+zip") return { label: "Book", partWord: "chapter" };
  if (type === "DOCUMENTATION") return { label: "Documentation", partWord: "chapter" };
  if (mime === "message/rfc822") return { label: "Email", partWord: "message" };
  if (type === "TRANSCRIPT") return { label: "Transcript", partWord: "part" };
  if (type === "WEB_PAGE") return { label: "Web page", partWord: "section" };
  if (a.kind === "feed") return { label: kindWord(a), partWord: "item" };
  if (a.kind === "text") return { label: "Text", partWord: "part" };
  if (a.kind === "agent") return { label: "Written by an agent", partWord: "chapter" };
  return { label: kindWord(a), partWord: "section" };
}
