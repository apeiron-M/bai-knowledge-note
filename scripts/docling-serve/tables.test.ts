import { describe, expect, it } from "vitest";
import {
  columnBands,
  detectTables,
  groupRows,
  renderTable,
  type TableRun,
} from "./tables.mjs";

const run = (
  str: string,
  x: number,
  y: number,
  width: number,
  size = 12,
): TableRun => ({
  str,
  x,
  y,
  width,
  size,
});

// The Sky report's appendix P&L, page 12, exactly as pdf.js reads it: a header
// row, value rows whose money columns are right-aligned, and account labels
// that sit alone on their own baseline.
const pnl: TableRun[] = [
  run("Full Quarterly P&L 2025 to 2026", 55, 954, 800, 40),
  run("ACCOUNT", 75, 834, 88),
  run("Q1 ‘25", 829, 834, 51),
  run("Q2 ‘25", 1071, 834, 51),
  run("Q3 ‘25", 1315, 834, 51),
  run("Q4 ‘25", 1560, 834, 51),
  run("Q1 ‘26", 1809, 834, 51),
  run("Gross Protocol Revenue", 100, 768, 230),
  run("$96.01M", 799, 768, 80),
  run("$85.16M", 1047, 768, 80),
  run("$84.52M", 1287, 768, 80),
  run("$78.97M", 1535, 768, 80),
  run("$123.79M", 1771, 768, 88),
  run("$96.01M", 816, 714, 63),
  run("$85.14M", 1064, 714, 63),
  run("$76.22M", 1307, 714, 63),
  run("$74.94M", 1551, 714, 63),
  run("$123M", 1811, 714, 50),
  run("Stability Fee Revenues", 92, 702, 158),
  run("100%", 843, 690, 37),
  run("100%", 1088, 690, 37),
  run("90.2%", 1328, 690, 42),
  run("94.9%", 1573, 690, 42),
  run("99.4%", 1819, 690, 42),
  run("Expense", 100, 570, 66),
  run("$109.52M", 789, 570, 91),
  run("$64.61M", 1045, 570, 80),
  run("$53.18M", 1293, 570, 80),
  run("$55.09M", 1532, 570, 80),
  run("$63.06M", 1776, 570, 80),
];

describe("groupRows", () => {
  it("groups runs that share a baseline, left to right, top first", () => {
    const rows = groupRows(pnl);
    expect(rows[0].runs.map((r) => r.str)).toEqual([
      "Full Quarterly P&L 2025 to 2026",
    ]);
    expect(rows[1].runs.map((r) => r.str)).toEqual([
      "ACCOUNT",
      "Q1 ‘25",
      "Q2 ‘25",
      "Q3 ‘25",
      "Q4 ‘25",
      "Q1 ‘26",
    ]);
  });
});

describe("columnBands", () => {
  it("finds the columns from whitespace, not from left edges — the money column is right-aligned", () => {
    // `$96.01M` starts at 799 and `100%` at 843 in the same column: clustering
    // starts produced 15 columns on this page where there are 6.
    const bands = columnBands(groupRows(pnl).slice(1));
    expect(bands).toHaveLength(6);
    const [label, firstMoney] = bands;
    expect(label.left).toBe(75);
    expect(firstMoney.left).toBeLessThanOrEqual(799);
    expect(firstMoney.right).toBeGreaterThanOrEqual(880);
  });
});

describe("detectTables", () => {
  it("reads the P&L as one six-column table, header included, digits intact", () => {
    const [table] = detectTables(pnl);
    expect(table.grid[0]).toEqual([
      "ACCOUNT",
      "Q1 ‘25",
      "Q2 ‘25",
      "Q3 ‘25",
      "Q4 ‘25",
      "Q1 ‘26",
    ]);
    expect(table.grid[1]).toEqual([
      "Gross Protocol Revenue",
      "$96.01M",
      "$85.16M",
      "$84.52M",
      "$78.97M",
      "$123.79M",
    ]);
    // The title is above the header and is not part of the table.
    expect(table.grid.some((row) => row[0].startsWith("Full Quarterly"))).toBe(
      false,
    );
  });

  it("keeps a label that sits on its own baseline on its own row, rather than guessing which values it belongs to", () => {
    const [table] = detectTables(pnl);
    const label = table.grid.find((row) => row[0] === "Stability Fee Revenues");
    expect(label).toBeDefined();
    expect(label?.slice(1).every((cell) => cell === "")).toBe(true);
  });

  it("leaves prose alone: one column is not a table", () => {
    const prose: TableRun[] = [
      run(
        "Q1 2026 broke every revenue record in protocol history. Gross",
        55,
        856,
        611,
        20,
      ),
      run(
        "Protocol Revenue reached $123.79M, ending three consecutive",
        55,
        830,
        611,
        20,
      ),
      run(
        "quarters of declining revenue and surpassing the prior peak of",
        55,
        804,
        611,
        20,
      ),
      run("$96.01M set in Q1 2025.", 55, 778, 300, 20),
    ];
    expect(detectTables(prose)).toEqual([]);
  });

  it("leaves a grid of cards alone: many columns, but the cells are sentences", () => {
    // The Sky report's page 2 — four columns of product descriptions. Columns
    // alone would make it a table; the value test is what keeps it prose.
    const cards: TableRun[] = [];
    const columns = [192, 512, 832, 1152];
    for (const [i, x] of columns.entries()) {
      cards.push(run(`Product ${i + 1}`, x, 191, 90, 15));
      cards.push(run("An independent entity doing a thing", x, 175, 240, 14));
      cards.push(run("described across two lines of prose.", x, 161, 240, 14));
    }
    expect(detectTables(cards)).toEqual([]);
  });

  it("needs enough rows before it calls something a table", () => {
    const two = pnl.filter((r) => r.y === 834 || r.y === 768);
    expect(detectTables(two)).toEqual([]);
  });
});

describe("renderTable", () => {
  it("writes a markdown table with the first row as the header", () => {
    const [table] = detectTables(pnl);
    const lines = renderTable(table.grid).split("\n");
    expect(lines[0]).toBe(
      "| ACCOUNT | Q1 ‘25 | Q2 ‘25 | Q3 ‘25 | Q4 ‘25 | Q1 ‘26 |",
    );
    expect(lines[1]).toBe("| --- | --- | --- | --- | --- | --- |");
    expect(lines[2]).toBe(
      "| Gross Protocol Revenue | $96.01M | $85.16M | $84.52M | $78.97M | $123.79M |",
    );
  });

  it("leaves the header empty rather than promoting a row of values to column names", () => {
    const lines = renderTable([
      ["", "$1", "$2"],
      ["a", "$3", "$4"],
    ]).split("\n");
    expect(lines[0]).toBe("|  |  |  |");
    expect(lines[2]).toBe("|  | $1 | $2 |");
    expect(lines[3]).toBe("| a | $3 | $4 |");
  });

  it("escapes a pipe inside a cell, so one cell cannot become two", () => {
    expect(renderTable([["a|b", "c"]]).split("\n")[0]).toBe("| a\\|b | c |");
  });
});

describe("two-column tables", () => {
  // The Sky report's balance sheet: ACCOUNT | Q1 '26, nothing else.
  const balanceSheet: TableRun[] = [
    run("ACCOUNT", 75, 844, 88),
    run("Q1 ‘26", 1334, 844, 51),
    run("Protocol Collateral", 100, 794, 190),
    run("$13.03B", 1312, 794, 72),
    run("Buffers", 92, 745, 70),
    run("$24.48M", 1320, 745, 72),
    run("Primes Vaults", 92, 695, 120),
    run("$6.99B", 1332, 695, 62),
    run("Sky Capital Buffer", 92, 645, 165),
    run("$146M", 1335, 645, 58),
    run("PSM Vaults", 92, 595, 100),
    run("$5.09B", 1332, 595, 62),
  ];

  it("reads a label-and-value table, which three columns would have rejected", () => {
    const [table] = detectTables(balanceSheet);
    expect(table).toBeDefined();
    expect(table.grid[0]).toEqual(["ACCOUNT", "Q1 ‘26"]);
    expect(table.grid).toContainEqual(["Protocol Collateral", "$13.03B"]);
    expect(table.grid).toContainEqual(["PSM Vaults", "$5.09B"]);
  });

  it("does not read prose with a sidebar as a two-column table", () => {
    // The Sky report's page 6: a paragraph column and a caption column. Two
    // bands, several rows — and every cell a sentence.
    const sidebar: TableRun[] = [
      run(
        "Total expenses in Q1 2026 were $63.06M, up 14.5% from $55.09M in",
        55,
        856,
        611,
        20,
      ),
      run(
        "Integration Expenses of $7.57M reflect Integration",
        725,
        856,
        400,
        20,
      ),
      run(
        "Q4 2025 as growing deposits required higher yield payments. That",
        55,
        830,
        611,
        20,
      ),
      run("protocols for integrating USDS and sUSDS.", 725, 830, 400, 20),
      run(
        "said, Sky Protocol is becoming more efficient. As a percentage of",
        55,
        804,
        611,
        20,
      ),
      run("Q1 2026 Protocol Expenses by Category", 745, 804, 380, 20),
      run(
        "Gross Protocol Revenue, total expenses declined from 69.76% in Q4",
        55,
        778,
        611,
        20,
      ),
      run("DAI Savings", 951, 778, 100, 14),
    ];
    expect(detectTables(sidebar)).toEqual([]);
  });

  it("does not read a short label-and-value pair as a table", () => {
    expect(detectTables(balanceSheet.slice(0, 6))).toEqual([]);
  });
});
