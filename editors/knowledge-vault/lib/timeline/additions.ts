/**
 * Words and small facts about additions: how each one arrived (its route),
 * what to call its kind, which one is still being read.
 */
import { isNoteGroup, type AdditionKind, type SourceTimeline, type TimelineAddition } from "../../../../processors/graph-indexer/source-timeline.js";
import { formatBadge } from "../intake-model.js";
import { formatFileSize } from "../mime.js";
import { dayKey, formatter, type TimeWords } from "./axis.js";

/** How an addition arrived, for the filter chips. */
export type Route = "files" | "text" | "feeds" | "agents" | "written" | "imported" | "unsourced";

const ROUTE_OF: Record<AdditionKind, Route> = {
  file: "files",
  text: "text",
  feed: "feeds",
  agent: "agents",
  written: "written",
  imported: "imported",
  unsourced: "unsourced",
};

export const ROUTE_ORDER: readonly Route[] = ["files", "text", "feeds", "agents", "written", "imported", "unsourced"];

/** The chip's label. */
export const ROUTE_LABEL: Record<Route, string> = {
  files: "Files",
  text: "Text",
  feeds: "Feeds",
  agents: "Agents",
  written: "Written here",
  imported: "Imported",
  unsourced: "No source",
};

/** In a sentence: "Mostly feeds", "Files and text". */
export const ROUTE_WORDS: Record<Route, string> = {
  files: "files",
  text: "text",
  feeds: "feeds",
  agents: "agent writing",
  written: "notes written here",
  imported: "imported notes",
  unsourced: "notes without a source",
};

export function routeOf(a: Pick<TimelineAddition, "kind">): Route {
  return ROUTE_OF[a.kind];
}

// --- counting and naming ------------------------------------------------------

/** "1,044 sources", "1 topic". The copy is English, so are the separators. */
export function countOf(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

const FEED_WORD: Record<string, string> = { rss: "Feed", arxiv: "Papers", granola: "Meeting notes" };
const FEED_UNIT: Record<string, string> = { rss: "post", arxiv: "paper", granola: "meeting" };

/** What the row's kind says beside its title: "PDF", "Feed", "Written by an agent". */
export function kindWord(a: Pick<TimelineAddition, "kind" | "fileName" | "mimeType" | "tool">): string {
  switch (a.kind) {
    case "file":
      if (a.fileName) return formatBadge(a.fileName);
      return a.mimeType === "application/pdf" ? "PDF" : a.mimeType === "application/epub+zip" ? "EPUB" : "File";
    case "feed":
      return FEED_WORD[a.tool ?? ""] ?? "Workflow";
    case "agent":
      return "Written by an agent";
    case "written":
      return "Written here";
    case "imported":
      return "Imported";
    case "unsourced":
      return "No source recorded";
    default:
      return "Text";
  }
}

/** What one source of this addition is called: a chapter, a post, a source. */
export function unitOf(a: Pick<TimelineAddition, "kind" | "tool">): string {
  if (a.kind === "agent") return "chapter";
  if (a.kind === "feed") return FEED_UNIT[a.tool ?? ""] ?? "item";
  return "source";
}

/** "921 sources became 283 notes so far, in 18 new topics." */
export function becameLine(a: TimelineAddition): string {
  if (a.kind === "written") return `${countOf(a.notes, "note")} written in the vault, not drawn from a source.`;
  if (a.kind === "imported") return `${countOf(a.notes, "note")} imported, with no source in this vault.`;
  if (a.kind === "unsourced") {
    // Truthful whatever the provenance says: extracted from a source since
    // removed, or added (by an agent or a script) without one.
    return a.notes === 1
      ? "1 note has no recorded source. It may have been removed, or the note was added without one."
      : `${countOf(a.notes, "note")} have no recorded source. It may have been removed, or the notes were added without one.`;
  }
  const unit = unitOf(a);
  if (a.notes === 0) return a.waiting > 0 ? `${countOf(a.sources, unit)}, waiting to be read.` : `${countOf(a.sources, unit)} read; none became a note.`;
  const what = a.kind === "agent" ? `${countOf(a.sources, unit)} written by an agent` : countOf(a.sources, unit);
  const so = a.waiting > 0 ? " so far" : "";
  const topics = a.topicIds.length > 0 ? `, in ${countOf(a.topicIds.length, "new topic")}` : "";
  return `${what} became ${countOf(a.notes, "note")}${so}${topics}.`;
}

/** "70 of 921 extracted, more arriving now" — only while sources wait. */
export function progressLine(a: TimelineAddition, live: boolean): string | null {
  if (a.waiting <= 0 || a.sources <= 0) return null;
  const done = `${a.extracted.toLocaleString("en-US")} of ${a.sources.toLocaleString("en-US")} extracted`;
  return live ? `${done}, more arriving now` : `${done}, ${a.waiting.toLocaleString("en-US")} waiting`;
}

/** "25 links to notes from earlier additions": the vault compounding. */
export function earlierLine(a: TimelineAddition): string | null {
  return a.linksToEarlier > 0 ? `${countOf(a.linksToEarlier, "link")} to notes from earlier additions` : null;
}

/** A signer at full length is noise: six and four characters identify it, and "you" says it best. */
export function whoLabel(id: string | null, me: string | null | undefined): string | null {
  if (!id) return null;
  if (me && id.toLowerCase() === me.toLowerCase()) return "you";
  if (/^0x[0-9a-f]{40}$/i.test(id)) return `${id.slice(0, 6)}…${id.slice(-4)}`;
  if (id.startsWith("did:key:") && id.length > 24) return `${id.slice(0, 12)}…${id.slice(-5)}`;
  return id;
}

// --- time words -----------------------------------------------------------------

/** "7:04 PM" */
export function clock(ms: number, o: TimeWords = {}): string {
  return formatter(o, { hour: "numeric", minute: "2-digit" }).format(ms);
}

const DAY = 86_400_000;
const yearOf = (ms: number, o: TimeWords) => dayKey(ms, o).slice(0, 4);

/** "Today", "Yesterday", "Saturday, October 10", "Friday, October 10, 2025". */
export function dayLabel(ms: number, now: number, o: TimeWords = {}): string {
  const k = dayKey(ms, o);
  if (k === dayKey(now, o)) return "Today";
  if (k === dayKey(now - DAY, o)) return "Yesterday";
  const sameYear = yearOf(ms, o) === yearOf(now, o);
  return formatter(o, sameYear ? { weekday: "long", month: "long", day: "numeric" } : { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(ms);
}

/** "today at 7:04 PM", "on Thursday, October 15 at 7:04 PM". */
function whenSaid(ms: number, now: number, o: TimeWords): string {
  const day = dayLabel(ms, now, o);
  const on = day === "Today" ? "today" : `on ${day === "Yesterday" ? formatter(o, { weekday: "long", month: "long", day: "numeric" }).format(ms) : day}`;
  return `${on} at ${clock(ms, o)}`;
}

/** "7 minutes", "1 hour", "3 hours". */
function spanSaid(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return countOf(minutes, "minute");
  return countOf(Math.round(minutes / 60), "hour");
}

/** The open row's first line: when, by whom, which file, the split and the written date. */
export function factsLine(a: TimelineAddition, now: number, o: TimeWords & { me?: string | null; who?: boolean } = {}): string {
  const at = Date.parse(a.addedAt);
  const parts: string[] = [];
  if (a.sources > 0) {
    // In a one-person vault "by did:key:…" on every row is noise: name people only when there are several.
    const who = o.who === false ? null : whoLabel(a.addedBy, o.me);
    parts.push(`Added ${whenSaid(at, now, o)}${who ? ` by ${who}` : ""}.`);
    if (a.fileName) parts.push(`File: ${a.fileName}${a.sizeBytes ? `, ${formatFileSize(a.sizeBytes)}` : ""}.`);
    if (a.kind === "file" && a.sources > 1) parts.push(`Split into ${countOf(a.sources, "source")} in ${spanSaid(Date.parse(a.lastAddedAt) - at)}.`);
  } else parts.push(`Arrived ${whenSaid(at, now, o)}.`);
  if (a.writtenFrom) {
    const w = Date.parse(a.writtenFrom);
    const date = formatter(o, yearOf(w, o) === yearOf(now, o) ? { month: "long", day: "numeric" } : { month: "long", day: "numeric", year: "numeric" }).format(w);
    parts.push(`Its notes were written on ${date}, before they came into this vault.`);
  }
  return parts.join(" ");
}

// --- the whole timeline ----------------------------------------------------------

/** A note within this long before now keeps an addition "live": still being read, more arriving. */
export const LIVE_WINDOW_MS = 60 * 60_000;

/**
 * The addition still being read: sources waiting, and the most recent note —
 * within the hour, so a stalled pipeline stops saying more is arriving.
 */
export function liveAddition(additions: readonly TimelineAddition[], now: number, windowMs = LIVE_WINDOW_MS): string | null {
  let best: TimelineAddition | null = null;
  for (const a of additions) {
    if (a.waiting <= 0 || a.notes <= 0) continue;
    const last = Date.parse(a.lastNoteAt ?? "");
    if (!(now - last <= windowMs)) continue;
    if (!best || last > Date.parse(best.lastNoteAt ?? "")) best = a;
  }
  return best?.id ?? null;
}

export interface SummaryPart {
  text: string;
  strong?: boolean;
}

/** "Since Saturday, October 10, 8 additions became 600 notes in 46 topics…", the numbers in bold. */
export function summaryParts(timeline: SourceTimeline, liveId: string | null, now: number, o: TimeWords = {}): SummaryPart[] {
  const real = timeline.additions.filter((a) => !isNoteGroup(a));
  const notesOf = (kind: AdditionKind) => timeline.additions.filter((a) => a.kind === kind).reduce((s, a) => s + a.notes, 0);
  const written = notesOf("written");
  const imported = notesOf("imported");
  const unsourced = notesOf("unsourced");
  // Notes with no source and no time belong to no addition; say so rather than lose them.
  const undated = timeline.notes.filter((n) => n.additionId === null).length;
  const extras: string[] = [];
  if (written) extras.push(`${countOf(written, "note")} ${written === 1 ? "was" : "were"} written here`);
  if (imported) extras.push(`${countOf(imported, "note")} ${imported === 1 ? "was" : "were"} imported`);
  const parts: SummaryPart[] = [];
  if (real.length > 0) {
    const first = Math.min(...real.map((a) => Date.parse(a.addedAt)));
    const day = dayLabel(first, now, o);
    const since = day === "Today" || day === "Yesterday" ? day.toLowerCase() : day;
    parts.push(
      { text: `Since ${since}, ` },
      { text: countOf(real.length, "addition"), strong: true },
      { text: " became " },
      { text: countOf(real.reduce((s, a) => s + a.notes, 0), "note"), strong: true },
      { text: " in " },
      { text: countOf(timeline.topics.length, "topic"), strong: true },
    );
    if (extras.length) parts.push({ text: `, and ${extras.join(" and ")}` });
  } else if (extras.length) parts.push({ text: extras.join(" and ") });
  if (unsourced) parts.push({ text: `${parts.length ? "; " : ""}${countOf(unsourced, "note")} ${unsourced === 1 ? "has" : "have"} no recorded source` });
  if (undated) parts.push({ text: `${parts.length ? "; " : ""}${countOf(undated, "note")} ${undated === 1 ? "has" : "have"} no recorded date` });
  if (parts.length) parts.push({ text: "." });
  const live = timeline.additions.find((a) => a.id === liveId);
  if (live) parts.push({ text: ` ${live.title} is still being read, so its layer is still growing.` });
  return parts;
}

export interface DayGroup {
  key: string;
  label: string;
  /** Newest first. */
  additions: TimelineAddition[];
  notes: number;
}

/** Additions by the day they arrived, newest day and newest addition first. */
export function dayGroups(additions: readonly TimelineAddition[], now: number, o: TimeWords = {}): DayGroup[] {
  const groups: DayGroup[] = [];
  const sorted = [...additions].sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt));
  for (const a of sorted) {
    const at = Date.parse(a.addedAt);
    const key = dayKey(at, o);
    let g = groups.at(-1);
    if (!g || g.key !== key) {
      g = { key, label: dayLabel(at, now, o), additions: [], notes: 0 };
      groups.push(g);
    }
    g.additions.push(a);
    g.notes += a.notes;
  }
  return groups;
}

/** The chips: each route that has additions, in a fixed order, with its count. */
export function routeCounts(additions: readonly TimelineAddition[]): [Route, number][] {
  const counts = new Map<Route, number>();
  for (const a of additions) counts.set(routeOf(a), (counts.get(routeOf(a)) ?? 0) + 1);
  return ROUTE_ORDER.filter((r) => counts.has(r)).map((r) => [r, counts.get(r) as number]);
}

/** Additions on this route (or all) whose title or file name holds the query. */
export function filterAdditions(additions: readonly TimelineAddition[], route: Route | "all", query: string): TimelineAddition[] {
  const q = query.trim().toLowerCase();
  return additions.filter((a) => (route === "all" || routeOf(a) === route) && (!q || a.title.toLowerCase().includes(q) || (a.fileName ?? "").toLowerCase().includes(q)));
}

/** About this many rows before "Show earlier days". */
export const PAGE_ROWS = 60;

/**
 * Whole days, newest first, until about `limit` rows — and always through the
 * day holding `include` (an addition opened from the chart or the graph).
 * A year of hourly feeds would otherwise render thousands of rows at once.
 */
export function pageGroups(groups: readonly DayGroup[], limit: number, include?: string | null): { shown: DayGroup[]; hiddenAdditions: number; rowsShown: number } {
  let last = -1;
  let rows = 0;
  for (let i = 0; i < groups.length; i++) {
    if (rows >= limit && i > 0) break;
    rows += groups[i].additions.length;
    last = i;
  }
  if (include) {
    const at = groups.findIndex((g) => g.additions.some((a) => a.id === include));
    if (at > last) last = at;
  }
  const shown = groups.slice(0, last + 1);
  const hiddenAdditions = groups.slice(last + 1).reduce((s, g) => s + g.additions.length, 0);
  const rowsShown = shown.reduce((s, g) => s + g.additions.length, 0);
  return { shown, hiddenAdditions, rowsShown };
}
