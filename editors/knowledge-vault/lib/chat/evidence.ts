/**
 * Evidence for each inline citation: the passage of the cited document that
 * supports the sentence the marker sits on.
 *
 * The model cites by [[documentId]]; the reader wants to know *which line* of
 * the document backs the claim without opening it. Nothing in the answer says
 * that, but the turn's tool results carried the documents' text — a note's
 * content, a source window, a scope's outline — so it can be recovered: take
 * the sentence before the marker, find the passage of the cited document that
 * shares the most words with it, keep that as the quote. For an anchored
 * marker ([[scopeId#itemId]]) the outline line that carries the same marker is
 * the item's own line and is used directly.
 *
 * Deterministic and local: no model call, computed once when the turn is
 * persisted, stored per marker occurrence. When nothing matches (the model
 * cited a search hit it never opened) the quote is null and the chip falls
 * back to the document's title.
 */

export interface Evidence {
  documentId: string;
  /** The item inside the document the marker named, if any. */
  anchor: string | null;
  /** The supporting passage, cleaned of markdown; null when none was found. */
  quote: string | null;
}

/** The subset of a trail entry this module reads. */
type TrailLike = { ok: boolean; data?: unknown };

/** `documentId#itemId` → its parts; a marker without `#` has no anchor. */
export function parseMarker(label: string): {
  documentId: string;
  anchor: string | null;
} {
  const hash = label.indexOf("#");
  if (hash === -1) return { documentId: label.trim(), anchor: null };
  const anchor = label.slice(hash + 1).trim();
  return { documentId: label.slice(0, hash).trim(), anchor: anchor || null };
}

const MARKER_RE = /\[\[([^\]]+?)\]\]/g;
/** An anchored marker inside a tool result's text: the item's own line. */
const ANCHORED_MARKER_RE = /\[\[([^\]#]+)#([^\]]+)\]\]/g;

/** Fields of a tool result that hold a document's prose. */
const TEXT_FIELDS = ["content", "text", "description", "orientation"] as const;
const MIN_PASSAGE = 25;
const MAX_PASSAGE = 400;
const MAX_PASSAGES_PER_DOCUMENT = 600;
const QUOTE_MAX = 280;
const MAX_DEPTH = 6;

/** Words that carry no topic; shared ones must not count as a match. */
const STOPWORDS = new Set(
  (
    "a an the and or but nor of to in on at by for with from as into onto than then so if " +
    "is are was were be been being am it its this that these those there their they them " +
    "we you your our he she his her him not no yes do does did done has have had having " +
    "will would can could should may might must shall about over under between after before " +
    "while because when where which who whom whose what how why also only each every any " +
    "all some such via per one two both either neither more most less very just still yet " +
    "here now up down out off again further once same other own too s t"
  ).split(" "),
);

/** Strip markdown decoration and citation markers; collapse whitespace. */
export function cleanPassage(line: string): string {
  return line
    .replace(/\[\[[^\]]*\]\]/g, "")
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+)/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=["'“([A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Meaningful words of a text, lowercased, deduplicated. Hyphens and slashes
 * split ("server-side" matches "server"), so compounds do not hide a match.
 */
export function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const out = new Set<string>();
  for (const w of words) {
    if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

export interface PassageIndex {
  /** Candidate passages per document, in document order. */
  byDocument: Map<string, string[]>;
  /** `documentId#itemId` → the cleaned line that carried that marker. */
  anchored: Map<string, string>;
}

/**
 * Every passage the tools surfaced this turn, keyed by the document it
 * belongs to. Walks tool results the way the citation harvester does: any
 * object with a `documentId` contributes the prose fields it carries.
 */
export function indexPassages(trail: readonly TrailLike[]): PassageIndex {
  const sets = new Map<string, Set<string>>();
  const anchored = new Map<string, string>();

  const addText = (documentId: string, text: string) => {
    let set = sets.get(documentId);
    if (!set) {
      set = new Set();
      sets.set(documentId, set);
    }
    for (const line of text.split("\n")) {
      for (const m of line.matchAll(ANCHORED_MARKER_RE)) {
        const key = `${m[1].trim()}#${m[2].trim()}`;
        if (!anchored.has(key)) anchored.set(key, cleanPassage(line));
      }
      for (const sentence of splitSentences(cleanPassage(line))) {
        if (sentence.length < MIN_PASSAGE) continue;
        if (set.size >= MAX_PASSAGES_PER_DOCUMENT) break;
        set.add(
          sentence.length > MAX_PASSAGE ? sentence.slice(0, MAX_PASSAGE) : sentence,
        );
      }
    }
  };

  const visit = (v: unknown, depth: number) => {
    if (depth > MAX_DEPTH || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    const obj = v as Record<string, unknown>;
    if (typeof obj.documentId === "string") {
      for (const field of TEXT_FIELDS) {
        const t = obj[field];
        if (typeof t === "string" && t.trim()) addText(obj.documentId, t);
      }
    }
    for (const value of Object.values(obj)) visit(value, depth + 1);
  };

  for (const e of trail) if (e.ok) visit(e.data, 0);
  return {
    byDocument: new Map([...sets].map(([id, set]) => [id, [...set]])),
    anchored,
  };
}

/**
 * The sentence a marker supports: from the last sentence boundary, line
 * start or previous marker up to the marker, without its own terminal
 * punctuation. A claim too short to match on is widened to its whole line.
 */
export function claimBefore(text: string, markerIndex: number): string {
  const before = text.slice(0, markerIndex);
  const lineStart = before.lastIndexOf("\n") + 1;
  const prevMarker = before.lastIndexOf("]]");
  const start = Math.max(lineStart, prevMarker === -1 ? 0 : prevMarker + 2);
  let segment = before.slice(start).replace(/[\s.!?:;,]+$/, "");
  const boundary = segment.search(/[.!?]\s+[^.!?]*$/);
  if (boundary !== -1) segment = segment.slice(boundary + 1);
  const claim = cleanPassage(segment);
  if (contentWords(claim).size >= 3) return claim;
  return cleanPassage(before.slice(lineStart).replace(/[\s.!?:;,]+$/, ""));
}

/**
 * The passage that best supports a claim: most shared content words,
 * normalised by length so a long paragraph does not win on volume. Needs at
 * least two shared words, and either a clear overlap or four shared words —
 * one coincidental term is not evidence.
 */
export function bestPassage(
  claim: string,
  passages: readonly string[],
): string | null {
  const a = contentWords(claim);
  if (a.size === 0) return null;
  let best: { passage: string; shared: number; score: number } | null = null;
  for (const passage of passages) {
    const b = contentWords(passage);
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    if (shared < 2) continue;
    const score = shared / Math.sqrt(a.size * b.size);
    if (
      !best ||
      score > best.score ||
      (score === best.score && passage.length < best.passage.length)
    ) {
      best = { passage, shared, score };
    }
  }
  if (!best) return null;
  if (best.score < 0.2 && best.shared < 4) return null;
  return best.passage;
}

function trimQuote(quote: string): string {
  if (quote.length <= QUOTE_MAX) return quote;
  const cut = quote.lastIndexOf(" ", QUOTE_MAX);
  return `${quote.slice(0, cut > QUOTE_MAX / 2 ? cut : QUOTE_MAX).trimEnd()}…`;
}

/**
 * One entry per `[[…]]` marker in `text`, in order — the same order
 * `numberCitations` counts them in, which is what ties a chip to its quote.
 */
export function collectEvidence(
  text: string,
  trail: readonly TrailLike[],
): Evidence[] {
  const index = indexPassages(trail);
  const out: Evidence[] = [];
  for (const m of text.matchAll(MARKER_RE)) {
    const { documentId, anchor } = parseMarker(m[1]);
    let quote: string | null = null;
    if (anchor) quote = index.anchored.get(`${documentId}#${anchor}`) ?? null;
    if (!quote) {
      const passages = index.byDocument.get(documentId);
      if (passages && passages.length > 0) {
        quote = bestPassage(claimBefore(text, m.index), passages);
      }
    }
    out.push({ documentId, anchor, quote: quote ? trimQuote(quote) : null });
  }
  return out;
}
