/**
 * Diffs for showing how a document's text changed between revisions.
 *
 * Three layers, each built on the one below:
 *
 *   diffLines    classic LCS over lines — what moved
 *   diffWords    the same LCS over word tokens — what changed *within* a line
 *   toDiffRows   pairs an adjacent removed/added run into one "changed" row
 *                so the caller can show the words that differ, not two lines
 *                the reader has to compare by eye
 *
 * The content here is prose, not code: a paragraph is one very long line, so
 * line-level output alone reports "this whole paragraph was replaced" for a
 * three-word edit. Word-level pairing is what makes a prose diff readable.
 *
 * Cost control matters because a source document can be hundreds of
 * kilobytes. Common prefixes and suffixes are stripped before any LCS runs
 * (the usual edit only touches the middle), and if what remains is still too
 * big the diff degrades to a block replacement rather than allocating a
 * quadratic table.
 */

/** Above this many cells (~n·m) an LCS table is not worth allocating. */
const MAX_LCS_CELLS = 4_000_000;

type Chunk<T> = { kind: "same" | "added" | "removed"; value: T };

/**
 * LCS diff of two sequences. Equal elements are emitted as `same`, so the
 * caller can render context or collapse it.
 */
function diffSequence<T>(a: T[], b: T[]): Chunk<T>[] {
  return diffSequenceEx(a, b).chunks;
}

/**
 * As `diffSequence`, and says whether the middle had to be reported as a
 * block replacement because aligning it precisely was too expensive. Word
 * diffs use this: an unaligned "before/after" pair is no more informative
 * than the two plain lines, so the caller skips it rather than pretending.
 */
function diffSequenceEx<T>(
  a: T[],
  b: T[],
): { chunks: Chunk<T>[]; degraded: boolean } {
  // Strip the common ends first: an append or a single-paragraph edit then
  // costs O(n) instead of O(n·m), which is the difference between a usable
  // diff and a frozen tab on a large source.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;

  const out: Chunk<T>[] = [];
  for (let i = 0; i < head; i++) out.push({ kind: "same", value: a[i] });

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  // The size that matters is what is left AFTER stripping the common ends,
  // not the raw input: appending a line to a 5000-line file is cheap.
  const degraded = (midA.length + 1) * (midB.length + 1) > MAX_LCS_CELLS;
  if (degraded) {
    for (const v of midA) out.push({ kind: "removed", value: v });
    for (const v of midB) out.push({ kind: "added", value: v });
  } else {
    out.push(...lcsChunks(midA, midB));
  }

  for (let i = a.length - tail; i < a.length; i++)
    out.push({ kind: "same", value: a[i] });
  return { chunks: out, degraded };
}

function lcsChunks<T>(a: T[], b: T[]): Chunk<T>[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((value) => ({ kind: "added" as const, value }));
  if (m === 0) return a.map((value) => ({ kind: "removed" as const, value }));

  // lcs[i][j] = length of LCS of a[i..] and b[j..]
  const lcs: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: Chunk<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", value: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "removed", value: a[i] });
      i++;
    } else {
      out.push({ kind: "added", value: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: "removed", value: a[i++] });
  while (j < m) out.push({ kind: "added", value: b[j++] });
  return out;
}

/* ------------------------------------------------------------------ */
/*  Lines                                                             */
/* ------------------------------------------------------------------ */

export type DiffLine =
  | { kind: "same"; text: string }
  | { kind: "added"; text: string }
  | { kind: "removed"; text: string };

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  return diffSequence(a, b).map((c) => ({ kind: c.kind, text: c.value }));
}

export type DiffSummary = { added: number; removed: number; changed: boolean };

export function summarizeDiff(lines: DiffLine[]): DiffSummary {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === "added") added++;
    else if (l.kind === "removed") removed++;
  }
  return { added, removed, changed: added + removed > 0 };
}

/* ------------------------------------------------------------------ */
/*  Words                                                             */
/* ------------------------------------------------------------------ */

export type DiffToken = {
  kind: "same" | "added" | "removed";
  text: string;
};

/**
 * Split into words, whitespace runs and punctuation runs, so that joining
 * the tokens back together reproduces the input exactly — a diff that
 * silently drops a space is worse than no diff.
 */
const TOKEN_RE = /\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}_'’]+/gu;

export function tokenizeWords(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

/**
 * Merge neighbouring tokens of the same kind into one.
 *
 * Tokenizing splits "Draft 13: " into five tokens; rendering each as its
 * own highlighted span would draw five separate rounded boxes across one
 * inserted phrase. Coalescing makes a run of changed words read as a single
 * mark, which is what it is.
 */
export function coalesceTokens(tokens: DiffToken[]): DiffToken[] {
  const out: DiffToken[] = [];
  for (const t of tokens) {
    const last = out.at(-1);
    if (last && last.kind === t.kind) last.text += t.text;
    else out.push({ ...t });
  }
  return out;
}

/**
 * Word-level diff of two single lines. Returns null when the pair is too
 * large to align, which tells the caller to fall back to whole-line
 * rendering rather than showing a misleading partial result.
 */
export function diffWords(before: string, after: string): DiffToken[] | null {
  const { chunks, degraded } = diffSequenceEx(
    tokenizeWords(before),
    tokenizeWords(after),
  );
  if (degraded) return null;
  return coalesceTokens(chunks.map((c) => ({ kind: c.kind, text: c.value })));
}

/**
 * Word-level rewrite of a line, for the "before" or "after" side only.
 * Dropping one side can leave two unchanged runs adjacent, so the result is
 * coalesced again.
 */
export function tokensForSide(
  tokens: DiffToken[],
  side: "before" | "after",
): DiffToken[] {
  const drop = side === "before" ? "added" : "removed";
  return coalesceTokens(tokens.filter((t) => t.kind !== drop));
}

/**
 * How much two lines have in common, 0…1 (Jaccard over lowercased words,
 * ignoring whitespace and punctuation). Used to decide whether a removed
 * and an added line are a rewrite of each other or two unrelated lines:
 * word-diffing unrelated lines produces confetti, so it is worth checking.
 */
export function similarity(a: string, b: string): number {
  const words = (s: string) =>
    new Set(
      tokenizeWords(s)
        .filter((t) => /[\p{L}\p{N}]/u.test(t))
        .map((t) => t.toLowerCase()),
    );
  const sa = words(a);
  const sb = words(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared++;
  const union = sa.size + sb.size - shared;
  return union === 0 ? 0 : shared / union;
}

/* ------------------------------------------------------------------ */
/*  Collapsing unchanged context                                      */
/* ------------------------------------------------------------------ */

/**
 * A folded run of unchanged lines. It keeps the lines it hid so the reader
 * can expand them in place instead of losing them.
 */
export type DiffGap = { kind: "gap"; hidden: number; lines: DiffLine[] };

export type CollapsedLine = DiffLine | DiffGap;

/**
 * Collapse long runs of unchanged lines to `context` lines on each side of a
 * change, inserting a `gap` marker with the number of lines hidden. Runs
 * shorter than `2 * context + 1` are kept whole — a one-line fold is noise.
 */
export function collapseUnchanged(
  lines: DiffLine[],
  context = 3,
): CollapsedLine[] {
  const out: CollapsedLine[] = [];
  let run: DiffLine[] = [];
  const flush = (isLast: boolean) => {
    if (run.length === 0) return;
    const keepHead = out.length === 0 ? 0 : context; // no leading context at start
    const keepTail = isLast ? 0 : context; // no trailing context at end
    if (run.length <= keepHead + keepTail + 1) {
      out.push(...run);
    } else {
      out.push(...run.slice(0, keepHead));
      const hiddenLines = run.slice(keepHead, run.length - keepTail);
      out.push({
        kind: "gap",
        hidden: hiddenLines.length,
        lines: hiddenLines,
      });
      if (keepTail > 0) out.push(...run.slice(run.length - keepTail));
    }
    run = [];
  };
  for (const l of lines) {
    if (l.kind === "same") {
      run.push(l);
    } else {
      flush(false);
      out.push(l);
    }
  }
  flush(true);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Rows: pairing a rewrite into one change                           */
/* ------------------------------------------------------------------ */

/**
 * A removed line and an added line are shown as one `changed` row when they
 * share at least this much vocabulary. Below it they are almost certainly
 * two different sentences, and pairing them would highlight nearly every
 * word.
 */
const PAIR_THRESHOLD = 0.3;

export type DiffRow =
  | { kind: "same"; text: string }
  | { kind: "added"; text: string }
  | { kind: "removed"; text: string }
  /** One line rewritten into another; `tokens` is null when unalignable. */
  | {
      kind: "changed";
      before: string;
      after: string;
      tokens: DiffToken[] | null;
    }
  | DiffGap;

/**
 * Fold adjacent removed/added runs into `changed` rows where the two sides
 * look like a rewrite of each other. Everything else passes through, so the
 * output is still a faithful unified diff.
 */
export function toDiffRows(collapsed: CollapsedLine[]): DiffRow[] {
  const out: DiffRow[] = [];
  let removed: string[] = [];
  let added: string[] = [];

  const flush = () => {
    const n = Math.max(removed.length, added.length);
    for (let k = 0; k < n; k++) {
      // `.at` rather than `[]`: the two runs are usually different lengths,
      // and `at` is typed for the miss that `[]` hides.
      const r = removed.at(k);
      const a = added.at(k);
      if (r !== undefined && a !== undefined) {
        if (similarity(r, a) >= PAIR_THRESHOLD) {
          out.push({
            kind: "changed",
            before: r,
            after: a,
            tokens: diffWords(r, a),
          });
        } else {
          out.push({ kind: "removed", text: r });
          out.push({ kind: "added", text: a });
        }
      } else if (r !== undefined) {
        out.push({ kind: "removed", text: r });
      } else if (a !== undefined) {
        out.push({ kind: "added", text: a });
      }
    }
    removed = [];
    added = [];
  };

  for (const line of collapsed) {
    if (line.kind === "removed") {
      removed.push(line.text);
    } else if (line.kind === "added") {
      added.push(line.text);
    } else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out;
}
