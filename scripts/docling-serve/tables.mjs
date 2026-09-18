/**
 * Tables from a text layer's geometry.
 *
 * docling reconstructs tables from pixels and writes them into its own
 * markdown — but only where its layout model calls something a table. On the
 * Sky quarterly report it called nothing a table (25 pictures, 0 tables), so
 * the appendix P&L reached the source as rubble: `"ACCOUNT"`, `"$96.01M
 * 100%"`, `"—"`, a fragment per block. The numbers were never lost — pdf.js
 * reads them exactly — only their shape was.
 *
 * So the shape is recovered from the positions. Runs sharing a baseline are a
 * row; the whitespace that persists down the page separates columns; a band of
 * rows that fills several columns with short, value-shaped cells is a table.
 *
 * Two things were learned from the real page and are load-bearing here:
 *
 * - **Columns come from whitespace, not from left edges.** A money column is
 *   right-aligned, so `$96.01M` begins at x=799 and `100%` at x=843 in the
 *   same column; clustering starts produced 15 columns where there are 6.
 * - **A table's own label rows are not tabular.** "Stability Fee Revenues"
 *   sits alone on its line; cutting the band there split one table into three.
 *
 * The value test is also what keeps prose out: a page of paragraphs has one
 * column, and the Sky report's grid of product cards has four columns of
 * *sentences*, which fails the test and stays prose — correctly, because it is.
 *
 * Not attempted: merged cells, spanning headers, and rules it never sees. This
 * returns the grid it can defend and leaves the rest as text.
 */

/** A cell that reads as a value rather than a sentence: a number, a share, a dash. */
const VALUE = /^[($]?-?[\d.,]+\s*[%KMB]?\)?$|^[—–-]$|^n\/?a$/i;

export const DEFAULT_TABLE_OPTIONS = {
  /** Same row when baselines differ by less than this share of the text size. */
  rowTolerance: 0.6,
  /** Whitespace narrower than this (points) does not separate two columns. */
  columnGap: 24,
  /** A table needs at least this many columns, counting the label column. */
  minColumns: 2,
  /** …and at least this many tabular rows. */
  minRows: 3,
  /**
   * A two-column table (label → value) is a real and common shape — the Sky
   * report's balance sheet is one — but two columns are also what a page of
   * prose with a sidebar looks like, so it has to show more evidence: more
   * rows, and almost every cell a value.
   */
  narrowColumns: 3,
  minRowsNarrow: 5,
  minValueShareNarrow: 0.85,
  /** …and this share of its non-label cells must look like values. */
  minValueShare: 0.6,
  /** A cell longer than this is prose, not a value. */
  maxCellChars: 24,
  /** Label-only lines allowed between two tabular rows without ending the table. */
  maxRowsBetween: 3,
};

const isValue = (text, maxChars) => {
  const t = text.trim();
  return t.length > 0 && t.length <= maxChars && VALUE.test(t);
};

/**
 * Runs grouped into rows by baseline, each row left to right, top row first.
 * @param {{ str: string; x: number; y: number; width: number; size: number }[]} runs
 * @param {number} [tolerance]
 */
export function groupRows(
  runs,
  tolerance = DEFAULT_TABLE_OPTIONS.rowTolerance,
) {
  /** @type {{ y: number; runs: typeof runs }[]} */
  const rows = [];
  for (const run of runs) {
    if (!run.str.trim()) continue;
    const limit = Math.max(1, tolerance * (run.size || 10));
    const row = rows.find((r) => Math.abs(r.y - run.y) <= limit);
    if (row) row.runs.push(run);
    else rows.push({ y: run.y, runs: [run] });
  }
  for (const row of rows) row.runs.sort((a, b) => a.x - b.x);
  return rows.sort((a, b) => b.y - a.y);
}

/**
 * The columns of a set of rows, as x intervals: every run's span projected
 * onto the x axis, then merged. What survives separate is a column.
 * @param {{ runs: { x: number; width: number }[] }[]} rows
 * @param {number} [gap]
 * @returns {{ left: number; right: number }[]}
 */
export function columnBands(rows, gap = DEFAULT_TABLE_OPTIONS.columnGap) {
  const spans = rows
    .flatMap((r) =>
      r.runs.map((run) => ({
        left: run.x,
        right: run.x + Math.max(1, run.width),
      })),
    )
    .sort((a, b) => a.left - b.left);
  const bands = [];
  for (const span of spans) {
    const last = bands.at(-1);
    if (last && span.left - last.right <= gap)
      last.right = Math.max(last.right, span.right);
    else bands.push({ ...span });
  }
  return bands;
}

/** The band a run sits in: the one containing its centre, else the nearest. */
function bandOf(run, bands) {
  const centre = run.x + Math.max(1, run.width) / 2;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    if (centre >= band.left && centre <= band.right) return i;
    const distance =
      centre < band.left ? band.left - centre : centre - band.right;
    if (distance < bestDistance) [best, bestDistance] = [i, distance];
  }
  return best;
}

function isTabular(row, bands, o) {
  const columns = new Set(row.runs.map((run) => bandOf(run, bands)));
  const beyondFirst = row.runs.filter((run) => bandOf(run, bands) > 0);
  if (columns.size < o.minColumns || beyondFirst.length === 0) return false;
  const values = beyondFirst.filter((run) =>
    isValue(run.str, o.maxCellChars),
  ).length;
  return values / beyondFirst.length >= o.minValueShare;
}

function buildTable(rows, bands) {
  const used = new Set();
  for (const row of rows)
    for (const run of row.runs) used.add(bandOf(run, bands));
  const columns = [...used].sort((a, b) => a - b);
  const grid = rows.map((row) => {
    const cells = columns.map(() => "");
    for (const run of row.runs) {
      const text = run.str.trim();
      if (!text) continue;
      const at = columns.indexOf(bandOf(run, bands));
      cells[at] = cells[at] ? `${cells[at]} ${text}` : text;
    }
    return cells;
  });
  const sizes = rows.flatMap((r) => r.runs.map((run) => run.size || 10));
  return {
    top: rows[0].y + Math.max(...sizes),
    bottom: rows.at(-1).y,
    left: Math.min(...columns.map((c) => bands[c].left)),
    right: Math.max(...columns.map((c) => bands[c].right)),
    grid,
  };
}

/**
 * The tables in one page's runs.
 * @param {{ str: string; x: number; y: number; width: number; size: number }[]} runs
 * @param {Partial<typeof DEFAULT_TABLE_OPTIONS>} [options]
 * @returns {{ top: number; bottom: number; left: number; right: number; grid: string[][] }[]}
 */
export function detectTables(runs, options = {}) {
  const o = { ...DEFAULT_TABLE_OPTIONS, ...options };
  const rows = groupRows(runs, o.rowTolerance);
  if (rows.length < o.minRows) return [];
  const pageBands = columnBands(rows, o.columnGap);
  if (pageBands.length < o.minColumns) return [];

  const tabular = rows.map((row) => isTabular(row, pageBands, o));
  /** @type {{ from: number; to: number; count: number }[]} */
  const regions = [];
  for (let i = 0; i < rows.length; i++) {
    if (!tabular[i]) continue;
    const last = regions.at(-1);
    if (last && i - last.to <= o.maxRowsBetween + 1) {
      last.to = i;
      last.count += 1;
    } else {
      regions.push({ from: i, to: i, count: 1 });
    }
  }

  const tables = [];
  for (const region of regions) {
    if (region.count < o.minRows) continue;
    // The header is not tabular — "ACCOUNT | Q1 '25 | Q2 '25" holds no values —
    // so it sits just above the region and would be left behind, taking the
    // meaning of every column with it. Take the row above when it reaches the
    // same columns.
    let from = region.from;
    const above = rows[region.from - 1];
    if (above) {
      const withAbove = columnBands(
        rows.slice(region.from - 1, region.to + 1),
        o.columnGap,
      );
      const reach = new Set(above.runs.map((run) => bandOf(run, withAbove)))
        .size;
      if (reach >= o.minColumns) from = region.from - 1;
    }
    const slice = rows.slice(from, region.to + 1);
    // Columns are re-read from the table's own rows: the rest of the page
    // would otherwise widen or merge its bands.
    const own = columnBands(slice, o.columnGap);
    if (own.length < o.minColumns) continue;
    if (own.length < o.narrowColumns) {
      // Judged on the data rows: the header is a row of names by definition,
      // and counting it dragged a clean balance sheet under the bar.
      const data = rows.slice(region.from, region.to + 1);
      const rowsWithValues = data.filter((row) =>
        row.runs.some(
          (run) => bandOf(run, own) > 0 && isValue(run.str, o.maxCellChars),
        ),
      ).length;
      const cells = data.flatMap((row) =>
        row.runs.filter((run) => bandOf(run, own) > 0),
      );
      const values = cells.filter((run) =>
        isValue(run.str, o.maxCellChars),
      ).length;
      if (
        rowsWithValues < o.minRowsNarrow ||
        cells.length === 0 ||
        values / cells.length < o.minValueShareNarrow
      ) {
        continue;
      }
    }
    // Deliberately not merged: in this document an account name sits *between*
    // its value row and its percentage row, equidistant from both, so pairing
    // it with either is a guess — and a mis-attributed financial figure is
    // worse than a table with a label on its own line. The rows are written as
    // the geometry gives them.
    tables.push(buildTable(slice, own));
  }
  return tables;
}

/**
 * A grid as a markdown table. The first row is the header unless it holds
 * values, in which case the table is written with an empty header row —
 * inventing column names would be a lie about the document.
 * @param {string[][]} grid
 * @param {Partial<typeof DEFAULT_TABLE_OPTIONS>} [options]
 * @returns {string}
 */
export function renderTable(grid, options = {}) {
  const o = { ...DEFAULT_TABLE_OPTIONS, ...options };
  if (grid.length === 0) return "";
  const width = Math.max(...grid.map((r) => r.length));
  const pad = (row) => [
    ...row,
    ...Array(Math.max(0, width - row.length)).fill(""),
  ];
  const escape = (cell) => cell.replace(/\|/g, "\\|");
  const headerIsValues = pad(grid[0])
    .slice(1)
    .some((cell) => isValue(cell, o.maxCellChars));
  const header = headerIsValues ? Array(width).fill("") : pad(grid[0]);
  const body = headerIsValues ? grid : grid.slice(1);
  return [
    `| ${header.map(escape).join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...body.map((row) => `| ${pad(row).map(escape).join(" | ")} |`),
  ].join("\n");
}
