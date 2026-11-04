/**
 * What changed in the vault over a window — condensed from operation rows.
 *
 * A pure function over `graph_operations`-shaped rows plus a little graph
 * context: no kysely, no processor, no embedder, so the chat bundle (which
 * runs in the browser) may import it, as it does `summarize.ts`. The query
 * layer (`query.ts` `changes()`) fetches the rows; the subgraph and the HTTP
 * route serve the digest; the chat and the plugin read it.
 *
 * Per document, the window's operations collapse into events — one per kind,
 * the window's net effect against the baseline (each field's last value
 * before `since`). See docs/superpowers/specs/2026-11-04-change-history-design.md
 * §2, §3 and §7 for the rules this implements.
 */
import { buildStory, buildThenVsNow, storyFacts, type ChangeStory, type StoryContext, type ThenFields, type ThenVsNow } from "./changes-story.js";
import { gitRefOf } from "./summarize.js";

export type ChangeKind =
  | "created"
  | "revised"
  | "superseded"
  | "archived"
  | "restored"
  | "approved"
  | "reverified"
  | "source-added"
  | "source-revised"
  | "source-archived"
  | "source-deleted";

export interface OperationRow {
  documentId: string;
  documentType: string;
  operationType: string;
  timestamp: string;
  index: number;
  inputJson: string | null;
  signerAddress: string | null;
}

export interface FieldChange {
  before: string | null;
  after: string;
}

export interface ContentChange {
  /** The earlier text, clipped to {@link MAX_BEFORE_CHARS} (the hunks carry the diff). */
  before: string | null;
  hunks: string[];
  /** Lines added and removed (a line that only moved is not counted). */
  added: number;
  removed: number;
}

export interface ChangeEvent {
  kind: ChangeKind;
  documentId: string;
  documentType: string;
  title: string;
  at: string;
  by: string | null;
  significance: number;
  fields?: { title?: FieldChange; description?: FieldChange; content?: ContentChange };
  revisionNotes?: string[];
  supersededBy?: { documentId: string; title: string; reason: string | null };
  version?: { before: string | null; after: string };
  comment?: string | null;
  source?: {
    refBefore: string | null;
    refAfter: string | null;
    url: string | null;
    /** Null when the earlier text was never recorded (an index not yet backfilled). */
    added: number | null;
    removed: number | null;
    hunks: string[];
    /** The first {@link MAX_SOURCE_NOTE_IDS} notes derived from the source. */
    noteIds: string[];
    /** How many notes derive from the source. */
    noteCount: number;
  };
  derivedFrom?: string[];
  folded: Record<string, number>;
}

export interface ChangeTotals {
  created: number;
  revised: number;
  superseded: number;
  archived: number;
  reverified: number;
  sourcesRevised: number;
  sourcesAdded: number;
  documents: number;
  operations: number;
}

export interface ChangeGroup {
  key: string;
  kind: "moc" | "topic" | "folder" | "unplaced";
  id: string | null;
  title: string;
  totals: ChangeTotals;
  highlights: ChangeEvent[];
}

export interface ChangeScope {
  moc?: string;
  topic?: string;
  documentIds?: string[];
  q?: string;
  types?: string[];
}

export type MocTier = "HUB" | "DOMAIN" | "TOPIC";

export interface ChangeContext {
  nodes: Map<string, { title: string; documentType: string; status: string | null; topics: string[] }>;
  /**
   * `addedAt` (optional): when the source entered the vault. A re-ingest of a
   * source added before the window is a revision even when the index holds no
   * earlier ingestion row (an index not yet backfilled).
   */
  sources: Map<string, { title: string; folder: string | null; claimIds: string[]; addedAt?: string | null }>;
  mocsByNote: Map<string, { id: string; title: string; tier: MocTier }[]>;
  derivedFrom: Map<string, string[]>;
  edgeReason(source: string, target: string, type: string): string | null;
  /** What the knowledge story needs (Addendum A); without it the digest has no story. */
  story?: StoryContext;
}

export interface ChangeDigest {
  window: { since: string; until: string };
  scope: ChangeScope;
  totals: ChangeTotals;
  groups: ChangeGroup[];
  events?: ChangeEvent[];
  nextCursor?: string | null;
  /** What the vault knows now that it did not before, by main area (Addendum A). */
  story?: ChangeStory;
  /** For a `q` or `topic` scope: the scope's claims at `since` versus now. */
  thenVsNow?: ThenVsNow;
}

// ---- Limits (plan: Global Constraints) ----

export const EVENTS_DEFAULT_LIMIT = 50;
export const EVENTS_MAX_LIMIT = 200;
export const HIGHLIGHTS_PER_GROUP = 5;
export const MAX_HUNKS = 6;
export const MAX_HUNK_CHARS = 400;
/** A revised body's earlier text ships this much, no more. */
export const MAX_BEFORE_CHARS = 400;
export const MAX_SOURCE_NOTE_IDS = 20;

export const SIGNIFICANCE: Record<ChangeKind, number> = {
  superseded: 6,
  revised: 5,
  created: 4,
  "source-revised": 3,
  "source-added": 3,
  archived: 2,
  "source-archived": 2,
  "source-deleted": 2,
  approved: 1,
  restored: 1,
  reverified: 0,
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** A date-time that names its offset (`Z`, `+02:00`, `-0500`). */
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;
/** How every timestamp the indexer writes begins; anything else is not compared. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

/** A window or cursor the caller got wrong: a 400, never a 500. */
export class ChangeInputError extends Error {}

function utc(value: string): string {
  return value.includes("T") && !HAS_OFFSET.test(value) ? `${value}Z` : value;
}

/**
 * The window in UTC. A date-only `since` starts at 00:00Z; a date-only
 * `until` covers that whole day; a timestamp without an offset is UTC; no
 * `until` means now.
 */
export function parseWindow(
  since: string,
  until?: string | null,
  now: Date = new Date(),
): { since: string; until: string } {
  const from = DATE_ONLY.test(since) ? `${since}T00:00:00.000Z` : utc(since);
  const to = !until ? now.toISOString() : DATE_ONLY.test(until) ? `${until}T23:59:59.999Z` : utc(until);
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime())) throw new ChangeInputError(`since is not a date: ${since}`);
  if (Number.isNaN(b.getTime())) throw new ChangeInputError(`until is not a date: ${String(until)}`);
  if (a.getTime() > b.getTime()) throw new ChangeInputError(`since (${since}) is after until (${String(until)})`);
  return { since: a.toISOString(), until: b.toISOString() };
}

// ---- Operation vocabulary ----

/** Operations whose input sets a claim field, and which field. */
const TITLE_OPS = new Set(["SET_TITLE"]);
const DESCRIPTION_OPS = new Set(["SET_DESCRIPTION", "UPDATE_DESCRIPTION"]);
const CONTENT_OPS = new Set(["SET_CONTENT", "UPDATE_CLAIM_CONTENT"]);
const PATCH_OP = "PATCH_CONTENT";
const ARCHIVE_OPS = new Set(["ARCHIVE_NOTE", "ARCHIVE_OBSERVATION"]);
const RESTORE_OPS = new Set(["RESTORE_NOTE"]);
const APPROVE_OPS = new Set(["APPROVE_NOTE"]);
const DELETE_OPS = new Set(["DELETE_DOCUMENT", "PURGE_DOCUMENT"]);
/** A model's own creation operation: it sets the first title, description and (some) content. */
const CREATE_OPS = new Set(["CREATE_MOC", "CREATE_CLAIM", "CREATE_TENSION", "CREATE_OBSERVATION"]);
const SOURCE_TYPE = "bai/source";

/** Operation types that can make an event (the query layer fetches their inputs). */
export const EVENT_OPERATION_TYPES: readonly string[] = [
  "CREATE_DOCUMENT",
  ...CREATE_OPS,
  ...TITLE_OPS,
  ...DESCRIPTION_OPS,
  ...CONTENT_OPS,
  PATCH_OP,
  "SET_METADATA_FIELD",
  ...ARCHIVE_OPS,
  ...RESTORE_OPS,
  ...APPROVE_OPS,
  ...DELETE_OPS,
  "INGEST_SOURCE",
  "SET_SOURCE_STATUS",
  "ADD_RELATIONSHIP",
  "REMOVE_RELATIONSHIP",
];

/** Operation types whose last pre-window value is a baseline. */
export const BASELINE_OPERATION_TYPES: readonly string[] = [
  ...CREATE_OPS,
  ...TITLE_OPS,
  ...DESCRIPTION_OPS,
  ...CONTENT_OPS,
  PATCH_OP,
  "SET_METADATA_FIELD",
  "INGEST_SOURCE",
];

type Input = Record<string, unknown>;

function parseInput(row: OperationRow): Input {
  if (!row.inputJson) return {};
  try {
    const v: unknown = JSON.parse(row.inputJson);
    return v && typeof v === "object" ? (v as Input) : {};
  } catch {
    return {};
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function byTime(a: OperationRow, b: OperationRow): number {
  return a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.index - b.index;
}

function applyPatch(content: string | null, input: Input): string {
  const base = content ?? "";
  const offset = typeof input.offset === "number" ? input.offset : 0;
  const removeCount = typeof input.removeCount === "number" ? input.removeCount : 0;
  const insert = str(input.insert) ?? "";
  return base.slice(0, offset) + insert + base.slice(offset + removeCount);
}

/** The values a document's fields hold after these rows, starting from `start`. */
interface Fields {
  title: string | null;
  description: string | null;
  content: string | null;
  version: string | null;
  ingest: Input | null;
}

function foldFields(rows: OperationRow[], start: Fields): Fields {
  const f = { ...start };
  for (const row of rows) {
    const t = row.operationType;
    const input = parseInput(row);
    if (CREATE_OPS.has(t)) {
      f.title = str(input.title) ?? f.title;
      f.description = str(input.description) ?? f.description;
      f.content = str(input.content) ?? f.content;
    } else if (TITLE_OPS.has(t)) f.title = str(input.title) ?? f.title;
    else if (DESCRIPTION_OPS.has(t)) f.description = str(input.description) ?? f.description;
    else if (CONTENT_OPS.has(t)) f.content = str(input.content) ?? f.content;
    else if (t === PATCH_OP) f.content = applyPatch(f.content, input);
    else if (t === "SET_METADATA_FIELD" && input.field === "version") f.version = str(input.value);
    else if (t === "INGEST_SOURCE") f.ingest = input;
  }
  return f;
}

const EMPTY_FIELDS: Fields = { title: null, description: null, content: null, version: null, ingest: null };

// ---- Line diff (LCS) ----

export interface LineDiff {
  added: number;
  removed: number;
  hunks: string[];
}

/** Lines per side of one LCS window: a 400 × 400 table, whatever the text's size. */
const DIFF_WINDOW = 400;

function clip(s: string, max = MAX_HUNK_CHARS): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

type DiffOp = ["-" | "+" | " ", string];

/** The LCS edit script between two (small) line lists. */
function lcsOps(x: string[], y: string[]): DiffOp[] {
  const n = x.length;
  const m = y.length;
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      ops.push([" ", x[i]]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) ops.push(["-", x[i++]]);
    else ops.push(["+", y[j++]]);
  }
  while (i < n) ops.push(["-", x[i++]]);
  while (j < m) ops.push(["+", y[j++]]);
  return ops;
}

/**
 * The first {@link MAX_HUNKS} hunks (`-old` / `+new` lines, each ≤
 * {@link MAX_HUNK_CHARS} chars) between two texts, after the shared head and
 * tail. The LCS runs over windows of {@link DIFF_WINDOW} lines: a window's
 * script is kept up to its last matching line, and the next window starts
 * there, so a large source costs a few small tables rather than one huge one,
 * and the walk stops once the hunks are full.
 */
function firstHunks(before: string, after: string): string[] {
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const aEnd = a.length - tail;
  const bEnd = b.length - tail;

  const hunks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length && hunks.length < MAX_HUNKS) hunks.push(clip(current.join("\n")));
    current = [];
  };
  let i = head;
  let j = head;
  while ((i < aEnd || j < bEnd) && hunks.length < MAX_HUNKS) {
    const x = a.slice(i, Math.min(aEnd, i + DIFF_WINDOW));
    const y = b.slice(j, Math.min(bEnd, j + DIFF_WINDOW));
    const last = i + x.length >= aEnd && j + y.length >= bEnd;
    let ops = lcsOps(x, y);
    if (!last) {
      // Keep the script up to its last match: past it, the window's edge may
      // have cut a pair apart. With no match at all, the window is one change.
      let cut = -1;
      for (let k = ops.length - 1; k >= 0; k--) {
        if (ops[k][0] === " ") {
          cut = k;
          break;
        }
      }
      if (cut >= 0) ops = ops.slice(0, cut + 1);
    }
    for (const [op, line] of ops) {
      if (op === " ") {
        flush();
        i++;
        j++;
        continue;
      }
      if (op === "-") i++;
      else j++;
      // Blank lines count, but say nothing in a hunk.
      if (line.trim() !== "") current.push(`${op}${line}`);
    }
  }
  flush();
  return hunks;
}

/**
 * Lines added and removed between two texts (see {@link countLines}), with
 * the first {@link MAX_HUNKS} hunks (see {@link firstHunks}).
 */
export function diffLines(before: string, after: string): LineDiff {
  if (before === after) return { added: 0, removed: 0, hunks: [] };
  return { ...countLines(before, after), hunks: firstHunks(before, after) };
}

/**
 * Lines added and removed, cheaply: the shared head and tail trimmed, the
 * rest compared as line multisets (a line that only moved is not counted).
 * Linear, so every event can be weighed; {@link diffLines} then runs only for
 * the events a reader will see.
 */
export function countLines(before: string, after: string): { added: number; removed: number } {
  if (before === after) return { added: 0, removed: 0 };
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const counts = new Map<string, number>();
  for (let i = head; i < a.length - tail; i++) counts.set(a[i], (counts.get(a[i]) ?? 0) + 1);
  let added = 0;
  for (let j = head; j < b.length - tail; j++) {
    const c = counts.get(b[j]) ?? 0;
    if (c > 0) counts.set(b[j], c - 1);
    else added++;
  }
  let removed = 0;
  for (const c of counts.values()) removed += c;
  return { added, removed };
}

// ---- Revision history convention ----

/** The `- ` lines under a `## Revision history` heading. */
export function revisionHistoryLines(content: string | null): string[] {
  if (!content) return [];
  const lines = content.split("\n");
  const start = lines.findIndex((l) => /^##\s+Revision history\s*$/i.test(l.trim()));
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    if (line.startsWith("- ")) out.push(line.slice(2).trim());
  }
  return out;
}

// ---- Building events ----

function emptyTotals(): ChangeTotals {
  return { created: 0, revised: 0, superseded: 0, archived: 0, reverified: 0, sourcesRevised: 0, sourcesAdded: 0, documents: 0, operations: 0 };
}

function lastOf(rows: OperationRow[], types: Set<string> | string[]): OperationRow | undefined {
  const set = types instanceof Set ? types : new Set(types);
  for (let i = rows.length - 1; i >= 0; i--) if (set.has(rows[i].operationType)) return rows[i];
  return undefined;
}

function fieldChange(before: string | null, after: string | null): FieldChange | undefined {
  if (after === null || after === before) return undefined;
  return { before, after };
}

/** Diff size used to order events of one kind: larger first. */
function weight(e: ChangeEvent): number {
  const c = e.fields?.content;
  const fieldCount = (e.fields?.title ? 1 : 0) + (e.fields?.description ? 1 : 0);
  if (c) return c.added + c.removed + fieldCount;
  if (e.source) return (e.source.added ?? 0) + (e.source.removed ?? 0);
  return fieldCount;
}

type CursorKey = [number, number, string, string, string];

function keyOf(e: ChangeEvent): CursorKey {
  return [e.significance, weight(e), e.at, e.documentId, e.kind];
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The event order: significance, then diff size, then newest, then id and kind. */
function compareKeys(a: CursorKey, b: CursorKey): number {
  return b[0] - a[0] || b[1] - a[1] || cmpStr(b[2], a[2]) || cmpStr(a[3], b[3]) || cmpStr(a[4], b[4]);
}

function compareEvents(a: ChangeEvent, b: ChangeEvent): number {
  return compareKeys(keyOf(a), keyOf(b));
}

function toBase64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(b64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

/**
 * Opaque: the sort key of the last event on the page, and the window's end —
 * so a caller who gave no `until` pages through the same window rather than
 * one that moves to "now" with every page.
 */
function encodeCursor(e: ChangeEvent, until: string): string {
  return toBase64(JSON.stringify({ k: keyOf(e), u: until }));
}

function decodeCursor(cursor: string): { key: CursorKey; until: string } {
  let v: unknown;
  try {
    v = JSON.parse(fromBase64(cursor));
  } catch {
    v = null;
  }
  const c = v as { k?: unknown; u?: unknown } | null;
  if (!c || !Array.isArray(c.k) || c.k.length !== 5 || typeof c.u !== "string") {
    throw new ChangeInputError("cursor is not one this endpoint returned");
  }
  return { key: c.k as CursorKey, until: c.u };
}

/** The window end a cursor was issued for (the caller's `until` when it gives none). */
export function cursorUntil(cursor: string): string {
  return decodeCursor(cursor).until;
}

interface Built {
  events: ChangeEvent[];
  /** Texts to diff into hunks, once it is known which events are shown. */
  pending: Map<ChangeEvent, { before: string; after: string }>;
}

function buildEvents(
  rowsByDoc: Map<string, OperationRow[]>,
  baselineByDoc: Map<string, OperationRow[]>,
  superseded: Map<string, { row: OperationRow; by: string; reason: string | null }>,
  ctx: ChangeContext,
  window: { since: string },
): Built {
  const events: ChangeEvent[] = [];
  const pending: Built["pending"] = new Map();
  const titleOf = (id: string, fallback?: string | null): string =>
    ctx.nodes.get(id)?.title || fallback || ctx.sources.get(id)?.title || id;

  const docIds = new Set([...rowsByDoc.keys(), ...superseded.keys()]);
  for (const documentId of docIds) {
    const rows = rowsByDoc.get(documentId) ?? [];
    const documentType =
      rows[0]?.documentType ?? ctx.nodes.get(documentId)?.documentType ?? (ctx.sources.has(documentId) ? SOURCE_TYPE : "bai/knowledge-note");
    const base = foldFields(baselineByDoc.get(documentId) ?? [], EMPTY_FIELDS);
    const now = foldFields(rows, base);
    const docEvents: ChangeEvent[] = [];
    const folded: Record<string, number> = {};
    const used = new Set<OperationRow>();
    const make = (kind: ChangeKind, row: OperationRow | undefined, extra: Partial<ChangeEvent> = {}): ChangeEvent => ({
      kind,
      documentId,
      documentType,
      title: titleOf(documentId, now.title ?? str(now.ingest?.title)),
      at: row?.timestamp ?? "",
      by: row?.signerAddress ?? null,
      significance: SIGNIFICANCE[kind],
      folded: {},
      ...extra,
    });

    if (documentType === SOURCE_TYPE) {
      const ingest = lastOf(rows, ["INGEST_SOURCE"]);
      const deleted = lastOf(rows, DELETE_OPS);
      const statusRow = lastOf(rows, ["SET_SOURCE_STATUS"]);
      if (deleted) {
        used.add(deleted);
        docEvents.push(make("source-deleted", deleted));
      }
      if (ingest) {
        const firstIngestInWindow = rows.find((r) => r.operationType === "INGEST_SOURCE");
        const priorIngest = base.ingest;
        const addedAt = ctx.sources.get(documentId)?.addedAt ?? null;
        const existed = priorIngest !== null || (addedAt !== null && addedAt < window.since) || rows.filter((r) => r.operationType === "INGEST_SOURCE").length > 1;
        for (const r of rows) if (r.operationType === "INGEST_SOURCE") used.add(r);
        const after = now.ingest ?? {};
        if (!existed) {
          docEvents.push(make("source-added", ingest, { title: titleOf(documentId, str(after.title)) }));
        } else {
          // Before = the last ingestion before the window, else the first in it.
          const beforeInput = priorIngest ?? (firstIngestInWindow && firstIngestInWindow !== ingest ? parseInput(firstIngestInWindow) : null);
          const beforeText = str(beforeInput?.content);
          const afterText = str(after.content);
          // No earlier text recorded: the counts are unknown, not zero.
          const counts = beforeText !== null && afterText !== null ? countLines(beforeText, afterText) : null;
          const claimIds = ctx.sources.get(documentId)?.claimIds ?? [];
          const e = make("source-revised", ingest, {
            title: titleOf(documentId, str(after.title)),
            source: {
              refBefore: beforeInput ? gitRefOf(beforeInput.method) : null,
              refAfter: gitRefOf(after.method),
              url: str(after.url),
              added: counts?.added ?? null,
              removed: counts?.removed ?? null,
              hunks: [],
              noteIds: claimIds.slice(0, MAX_SOURCE_NOTE_IDS),
              noteCount: claimIds.length,
            },
          });
          if (counts && beforeText !== null && afterText !== null) pending.set(e, { before: beforeText, after: afterText });
          // Re-ingested with identical text: a re-verification of the source,
          // ranked with the other re-verifications (last).
          if (beforeText !== null && beforeText === afterText) e.significance = SIGNIFICANCE.reverified;
          docEvents.push(e);
        }
      }
      if (statusRow && str(parseInput(statusRow).status) === "ARCHIVED") {
        used.add(statusRow);
        docEvents.push(make("source-archived", statusRow));
      }
    } else {
      const created = rows.find((r) => r.operationType === "CREATE_DOCUMENT" || CREATE_OPS.has(r.operationType));
      if (created) {
        // Its in-window edits are its creation.
        for (const r of rows) if (r.operationType !== "ADD_RELATIONSHIP" || !isSupersedes(r)) used.add(r);
        docEvents.push(
          make("created", lastOf(rows, [...TITLE_OPS]) ?? created, {
            at: created.timestamp,
            by: created.signerAddress ?? lastOf(rows, [...TITLE_OPS])?.signerAddress ?? null,
            derivedFrom: ctx.derivedFrom.get(documentId) ?? [],
          }),
        );
      } else {
        const claimRows = rows.filter((r) => TITLE_OPS.has(r.operationType) || DESCRIPTION_OPS.has(r.operationType) || CONTENT_OPS.has(r.operationType) || r.operationType === PATCH_OP);
        const title = fieldChange(base.title, now.title);
        const description = fieldChange(base.description, now.description);
        let content: ContentChange | undefined;
        let contentTexts: { before: string; after: string } | undefined;
        if (now.content !== null && now.content !== base.content) {
          const d = countLines(base.content ?? "", now.content);
          content = { before: base.content === null ? null : clip(base.content, MAX_BEFORE_CHARS), hunks: [], added: d.added, removed: d.removed };
          contentTexts = { before: base.content ?? "", after: now.content };
        }
        const claimChanged = Boolean(title || description || content);
        for (const r of claimRows) used.add(r);
        if (claimChanged) {
          const last = claimRows[claimRows.length - 1];
          const before = new Set(revisionHistoryLines(base.content));
          const notes = revisionHistoryLines(now.content).filter((l) => !before.has(l));
          const fields: ChangeEvent["fields"] = {};
          if (title) fields.title = title;
          if (description) fields.description = description;
          if (content) fields.content = content;
          const e = make("revised", last, {
            fields,
            ...(notes.length ? { revisionNotes: notes } : {}),
            derivedFrom: ctx.derivedFrom.get(documentId) ?? [],
          });
          if (contentTexts) pending.set(e, contentTexts);
          docEvents.push(e);
        }
        const versionRow = lastOf(
          rows.filter((r) => r.operationType === "SET_METADATA_FIELD" && parseInput(r).field === "version"),
          ["SET_METADATA_FIELD"],
        );
        if (versionRow) {
          for (const r of rows) if (r.operationType === "SET_METADATA_FIELD" && parseInput(r).field === "version") used.add(r);
          if (!claimChanged && now.version !== null && now.version !== base.version) {
            docEvents.push(make("reverified", versionRow, { version: { before: base.version, after: now.version } }));
          }
        }
        const lifecycle = lastOf(rows, new Set([...ARCHIVE_OPS, ...RESTORE_OPS]));
        if (lifecycle) {
          for (const r of rows) if (ARCHIVE_OPS.has(r.operationType) || RESTORE_OPS.has(r.operationType)) used.add(r);
          const input = parseInput(lifecycle);
          docEvents.push(make(ARCHIVE_OPS.has(lifecycle.operationType) ? "archived" : "restored", lifecycle, { comment: str(input.comment) ?? str(input.reason) }));
        }
        const approval = lastOf(rows, APPROVE_OPS);
        if (approval) {
          for (const r of rows) if (APPROVE_OPS.has(r.operationType)) used.add(r);
          const input = parseInput(approval);
          docEvents.push(make("approved", approval, { by: str(input.actor) ?? approval.signerAddress, comment: str(input.comment) }));
        }
      }
    }

    const sup = superseded.get(documentId);
    if (sup) {
      used.add(sup.row);
      docEvents.push(
        make("superseded", sup.row, {
          supersededBy: { documentId: sup.by, title: titleOf(sup.by), reason: sup.reason },
        }),
      );
    }

    if (docEvents.length === 0) continue;
    for (const r of rows) {
      if (used.has(r)) continue;
      folded[r.operationType] = (folded[r.operationType] ?? 0) + 1;
    }
    docEvents.sort(compareEvents);
    docEvents[0].folded = folded;
    events.push(...docEvents);
  }
  return { events, pending };
}

/** How long a creating batch takes to settle: its fields are written within minutes (spec Addendum B4). */
export const FIRST_RECORD_MS = 60 * 60 * 1000;

/**
 * A created document's first recorded state: its title and description as
 * the last writes within {@link FIRST_RECORD_MS} of its creation left them,
 * when they were written, and the `## Revision history` lines added since.
 * Null when it has no creation row or no title/description in that hour.
 * `rows` are the document's rows in time order.
 */
export function firstRecorded(rows: OperationRow[]): { title: string | null; description: string | null; at: string; revisionNotes: string[] } | null {
  const create = rows.find((r) => r.operationType === "CREATE_DOCUMENT" || CREATE_OPS.has(r.operationType));
  if (!create) return null;
  const end = Date.parse(create.timestamp) + FIRST_RECORD_MS;
  const early = rows.filter((r) => Date.parse(r.timestamp) <= end);
  const first = foldFields(early, EMPTY_FIELDS);
  if (first.title === null && first.description === null) return null;
  const sets = early.filter((r) => {
    if (TITLE_OPS.has(r.operationType) || DESCRIPTION_OPS.has(r.operationType)) return true;
    if (!CREATE_OPS.has(r.operationType)) return false;
    const input = parseInput(r);
    return str(input.title) !== null || str(input.description) !== null;
  });
  const at = sets.length ? sets[sets.length - 1].timestamp : create.timestamp;
  const before = new Set(revisionHistoryLines(first.content));
  const revisionNotes = revisionHistoryLines(foldFields(rows, EMPTY_FIELDS).content).filter((l) => !before.has(l));
  return { title: first.title, description: first.description, at, revisionNotes };
}

function isSupersedes(row: OperationRow): boolean {
  return row.operationType === "ADD_RELATIONSHIP" && parseInput(row).relationshipType === "SUPERSEDES";
}

// ---- Grouping ----

const TIER_RANK: Record<MocTier, number> = { TOPIC: 0, DOMAIN: 1, HUB: 2 };

interface GroupRef {
  key: string;
  kind: ChangeGroup["kind"];
  id: string | null;
  title: string;
}

const UNPLACED: GroupRef = { key: "unplaced", kind: "unplaced", id: null, title: "Unplaced" };

function noteGroup(noteId: string, ctx: ChangeContext): GroupRef | null {
  // A map's own changes belong to the map, not to the maps above it.
  const node = ctx.nodes.get(noteId);
  if (node?.documentType === "bai/moc") return { key: `moc:${noteId}`, kind: "moc", id: noteId, title: node.title || noteId };
  const mocs = ctx.mocsByNote.get(noteId);
  if (mocs?.length) {
    const best = [...mocs].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))[0];
    return { key: `moc:${best.id}`, kind: "moc", id: best.id, title: best.title };
  }
  const topic = node?.topics[0];
  if (topic) return { key: `topic:${topic}`, kind: "topic", id: topic, title: topic };
  return null;
}

function groupOf(e: ChangeEvent, ctx: ChangeContext): GroupRef {
  if (e.documentType !== SOURCE_TYPE) return noteGroup(e.documentId, ctx) ?? UNPLACED;
  const source = ctx.sources.get(e.documentId);
  const votes = new Map<string, { ref: GroupRef; n: number }>();
  for (const noteId of source?.claimIds ?? []) {
    const ref = noteGroup(noteId, ctx);
    if (!ref) continue;
    const v = votes.get(ref.key) ?? { ref, n: 0 };
    v.n++;
    votes.set(ref.key, v);
  }
  const top = [...votes.values()].sort((a, b) => b.n - a.n || a.ref.title.localeCompare(b.ref.title))[0];
  if (top) return top.ref;
  if (source?.folder) return { key: `folder:${source.folder}`, kind: "folder", id: source.folder, title: source.folder };
  return UNPLACED;
}

function totalsOf(events: ChangeEvent[], operations: number): ChangeTotals {
  const t = emptyTotals();
  for (const e of events) {
    if (e.kind === "created") t.created++;
    else if (e.kind === "revised") t.revised++;
    else if (e.kind === "superseded") t.superseded++;
    else if (e.kind === "archived" || e.kind === "source-archived") t.archived++;
    else if (e.kind === "reverified") t.reverified++;
    else if (e.kind === "source-revised") t.sourcesRevised++;
    else if (e.kind === "source-added") t.sourcesAdded++;
  }
  t.documents = new Set(events.map((e) => e.documentId)).size;
  t.operations = operations;
  return t;
}

// ---- Scope ----

function inScope(documentId: string, documentType: string, scope: ChangeScope, ids: Set<string> | null, ctx: ChangeContext): boolean {
  if (scope.types?.length && !scope.types.includes(documentType)) return false;
  if (ids && !ids.has(documentId)) return false;
  const notesOf = (id: string): string[] => (documentType === SOURCE_TYPE ? (ctx.sources.get(id)?.claimIds ?? []) : [id]);
  // With explicit ids (the query layer resolves a MoC through its child maps),
  // the ids are the scope; moc/topic only narrow when no ids were given.
  if (scope.moc && !scope.documentIds) {
    if (!notesOf(documentId).some((n) => n === scope.moc || ctx.mocsByNote.get(n)?.some((m) => m.id === scope.moc))) return false;
  }
  if (scope.topic) {
    if (!notesOf(documentId).some((n) => ctx.nodes.get(n)?.topics.includes(scope.topic as string))) return false;
  }
  return true;
}

function hasScope(scope: ChangeScope): boolean {
  return Boolean(scope.moc || scope.topic || scope.documentIds || scope.q);
}

// ---- The digest ----

/**
 * Condense a window of operation rows into a {@link ChangeDigest}.
 *
 * `rows`: every operation in the window (others are ignored), including the
 * `ADD_RELATIONSHIP` rows of notes that supersede a document in scope.
 * `baseline`: rows before the window — the last value of each tracked field
 * per document (more is harmless; they are folded in time order).
 */
export function buildChanges(
  rows: OperationRow[],
  baseline: OperationRow[],
  ctx: ChangeContext,
  window: { since: string; until: string },
  opts: { scope: ChangeScope; limit?: number; cursor?: string | null; thenVsNow?: boolean },
): ChangeDigest {
  const scope = opts.scope;
  const ids = scope.documentIds ? new Set(scope.documentIds) : null;
  // String order is time order only for ISO timestamps (what the indexer
  // writes); anything else — an epoch stamp from an old writer — is skipped
  // rather than misplaced.
  const iso = (r: OperationRow) => ISO_TIMESTAMP.test(r.timestamp);
  const inWindow = rows.filter((r) => iso(r) && r.timestamp >= window.since && r.timestamp <= window.until).sort(byTime);

  // Supersession: the edge row lives on the replacing note; the event is the
  // replaced one's. A removal later in the window takes it back.
  const superseded = new Map<string, { row: OperationRow; by: string; reason: string | null }>();
  for (const row of inWindow) {
    const removal = row.operationType === "REMOVE_RELATIONSHIP";
    if (!removal && !isSupersedes(row)) continue;
    const input = parseInput(row);
    const target = str(input.targetId);
    const source = str(input.sourceId) ?? row.documentId;
    if (!target) continue;
    if (removal) {
      const type = str(input.relationshipType);
      if ((type === null || type === "SUPERSEDES") && superseded.get(target)?.by === source) superseded.delete(target);
      continue;
    }
    const metadata = input.metadata as { reason?: unknown } | undefined;
    superseded.set(target, {
      row,
      by: source,
      reason: ctx.edgeReason(source, target, "SUPERSEDES") ?? str(metadata?.reason),
    });
  }

  const rowsByDoc = new Map<string, OperationRow[]>();
  for (const row of inWindow) {
    if (!inScope(row.documentId, row.documentType, scope, ids, ctx)) continue;
    const list = rowsByDoc.get(row.documentId) ?? [];
    list.push(row);
    rowsByDoc.set(row.documentId, list);
  }
  for (const target of [...superseded.keys()]) {
    const type = ctx.nodes.get(target)?.documentType ?? "bai/knowledge-note";
    if (!inScope(target, type, scope, ids, ctx)) superseded.delete(target);
  }
  const baselineByDoc = new Map<string, OperationRow[]>();
  for (const row of [...baseline].sort(byTime)) {
    if (!iso(row) || row.timestamp >= window.since) continue;
    const list = baselineByDoc.get(row.documentId) ?? [];
    list.push(row);
    baselineByDoc.set(row.documentId, list);
  }

  const { events, pending } = buildEvents(rowsByDoc, baselineByDoc, superseded, ctx, window);
  events.sort(compareEvents);
  const operations = [...rowsByDoc.values()].reduce((n, l) => n + l.length, 0);
  const opsByDoc = new Map([...rowsByDoc].map(([id, l]) => [id, l.length]));

  const grouped = new Map<string, { ref: GroupRef; events: ChangeEvent[] }>();
  for (const e of events) {
    const ref = groupOf(e, ctx);
    const g = grouped.get(ref.key) ?? { ref, events: [] };
    g.events.push(e);
    grouped.set(ref.key, g);
  }
  const groups: ChangeGroup[] = [...grouped.values()]
    .map(({ ref, events: list }) => {
      const docs = new Set(list.map((e) => e.documentId));
      const ops = [...docs].reduce((n, id) => n + (opsByDoc.get(id) ?? 0), 0);
      return { ...ref, totals: totalsOf(list, ops), highlights: list.slice(0, HIGHLIGHTS_PER_GROUP) };
    })
    .sort(
      (a, b) =>
        (a.kind === "unplaced" ? 1 : 0) - (b.kind === "unplaced" ? 1 : 0) ||
        b.highlights[0].significance - a.highlights[0].significance ||
        b.totals.documents - a.totals.documents ||
        a.title.localeCompare(b.title),
    );

  const digest: ChangeDigest = { window, scope, totals: totalsOf(events, operations), groups };
  // A cursor page is the events' continuation: the first page carried the story.
  if (ctx.story && !opts.cursor) {
    // Each document's title and description at since, where a baseline recorded them.
    const thenFields: ThenFields = new Map();
    for (const [id, list] of baselineByDoc) {
      const f = foldFields(list, EMPTY_FIELDS);
      thenFields.set(id, { title: f.title, description: f.description });
    }
    // A note created in the window: its then is its first recorded state.
    for (const e of events) {
      if (e.kind !== "created") continue;
      const first = firstRecorded(rowsByDoc.get(e.documentId) ?? []);
      if (first) thenFields.set(e.documentId, first);
    }
    const facts = storyFacts(events, thenFields, ctx.story, window, ids);
    digest.story = buildStory(facts, ctx.story);
    if (opts.thenVsNow ?? Boolean(scope.q || scope.topic)) digest.thenVsNow = buildThenVsNow(facts, ctx.story);
  }
  const shown = groups.flatMap((g) => g.highlights);
  if (hasScope(scope)) {
    const limit = Math.min(EVENTS_MAX_LIMIT, Math.max(1, opts.limit ?? EVENTS_DEFAULT_LIMIT));
    const key = opts.cursor ? decodeCursor(opts.cursor).key : null;
    const remaining = key ? events.filter((e) => compareKeys(keyOf(e), key) > 0) : events;
    const page = remaining.slice(0, limit);
    digest.events = page;
    digest.nextCursor = remaining.length > limit ? encodeCursor(page[page.length - 1], window.until) : null;
    shown.push(...page);
  }
  // Hunks only for what the reader sees: a line diff of a large source is the
  // expensive part, and most events of a big window are only counted.
  for (const e of new Set(shown)) {
    const texts = pending.get(e);
    if (!texts) continue;
    const { hunks } = diffLines(texts.before, texts.after);
    if (e.fields?.content) e.fields.content.hunks = hunks;
    else if (e.source) e.source.hunks = hunks;
  }
  return digest;
}
