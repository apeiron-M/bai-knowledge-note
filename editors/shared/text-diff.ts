/**
 * Line-level diff for showing how a note's text changed between revisions.
 *
 * Classic LCS over lines: O(n·m) time and memory, which is nothing for a
 * knowledge note (a few hundred lines at most) and keeps the output stable
 * and easy to reason about — no heuristics, no move detection. Equal lines
 * are emitted as `same`, so the caller can render context or collapse it.
 */

export type DiffLine =
  | { kind: "same"; text: string }
  | { kind: "added"; text: string }
  | { kind: "removed"; text: string };

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  const n = a.length;
  const m = b.length;

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

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "removed", text: a[i] });
      i++;
    } else {
      out.push({ kind: "added", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: "removed", text: a[i++] });
  while (j < m) out.push({ kind: "added", text: b[j++] });
  return out;
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

/**
 * Collapse long runs of unchanged lines to `context` lines on each side of a
 * change, inserting a `gap` marker with the number of lines hidden. Runs
 * shorter than `2 * context + 1` are kept whole — a one-line fold is noise.
 */
export type CollapsedLine = DiffLine | { kind: "gap"; hidden: number };

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
      out.push({ kind: "gap", hidden: run.length - keepHead - keepTail });
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
