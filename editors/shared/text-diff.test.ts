import { describe, expect, it } from "vitest";
import {
  collapseUnchanged,
  diffLines,
  diffWords,
  similarity,
  summarizeDiff,
  toDiffRows,
  tokenizeWords,
  tokensForSide,
  type CollapsedLine,
  type DiffGap,
  type DiffRow,
} from "./text-diff.js";

describe("diffLines", () => {
  it("reports identical text as all-same", () => {
    const d = diffLines("a\nb", "a\nb");
    expect(d.every((l) => l.kind === "same")).toBe(true);
    expect(summarizeDiff(d)).toEqual({ added: 0, removed: 0, changed: false });
  });

  it("finds an insertion, a deletion and a replacement", () => {
    const d = diffLines("one\ntwo\nthree\nfour", "one\n2\nthree\nfour\nfive");
    expect(d).toEqual([
      { kind: "same", text: "one" },
      { kind: "removed", text: "two" },
      { kind: "added", text: "2" },
      { kind: "same", text: "three" },
      { kind: "same", text: "four" },
      { kind: "added", text: "five" },
    ]);
    expect(summarizeDiff(d)).toEqual({ added: 2, removed: 1, changed: true });
  });

  it("treats empty text as zero lines, not one empty line", () => {
    expect(diffLines("", "x")).toEqual([{ kind: "added", text: "x" }]);
    expect(diffLines("x", "")).toEqual([{ kind: "removed", text: "x" }]);
    expect(diffLines("", "")).toEqual([]);
  });

  it("keeps a shared prefix and suffix around an edit", () => {
    // Stripping the common ends must not change what the diff reports.
    const before = "h1\nh2\nmiddle\nt1\nt2";
    const after = "h1\nh2\nMIDDLE\nt1\nt2";
    expect(diffLines(before, after)).toEqual([
      { kind: "same", text: "h1" },
      { kind: "same", text: "h2" },
      { kind: "removed", text: "middle" },
      { kind: "added", text: "MIDDLE" },
      { kind: "same", text: "t1" },
      { kind: "same", text: "t2" },
    ]);
  });

  it("appends cheaply when the whole of the old text is a prefix", () => {
    const before = Array.from({ length: 5000 }, (_u, i) => `line ${i}`).join("\n");
    const after = `${before}\nnew tail`;
    const started = Date.now();
    const d = diffLines(before, after);
    // 5000×5001 cells would be a 100MB table; prefix stripping avoids it.
    expect(Date.now() - started).toBeLessThan(500);
    expect(summarizeDiff(d)).toEqual({ added: 1, removed: 0, changed: true });
  });

  it("degrades to a block replacement instead of a quadratic table", () => {
    const before = Array.from({ length: 2500 }, (_u, i) => `a${i}`).join("\n");
    const after = Array.from({ length: 2500 }, (_u, i) => `b${i}`).join("\n");
    const started = Date.now();
    const d = diffLines(before, after);
    expect(Date.now() - started).toBeLessThan(500);
    const s = summarizeDiff(d);
    expect(s).toEqual({ added: 2500, removed: 2500, changed: true });
    // Everything removed first, then everything added.
    expect(d[0].kind).toBe("removed");
    expect(d[d.length - 1].kind).toBe("added");
  });
});

describe("tokenizeWords", () => {
  it("round-trips exactly, punctuation and spacing included", () => {
    for (const s of [
      "The reactor stores every action.",
      "  indented\ttabbed  ",
      "hyphen-ish, it’s (parenthesised) — em-dashed…",
      "url: https://example.com/a?b=1",
      "",
    ]) {
      expect(tokenizeWords(s).join("")).toBe(s);
    }
  });
});

describe("diffWords", () => {
  it("marks only the words that changed", () => {
    const tokens = diffWords("the quick brown fox", "the slow brown fox");
    expect(tokens).not.toBeNull();
    const changed = tokens!.filter((t) => t.kind !== "same").map((t) => t.text);
    expect(changed).toEqual(["quick", "slow"]);
    // No two neighbours share a kind, so each mark is one span.
    for (let i = 1; i < tokens!.length; i++) {
      expect(tokens![i].kind).not.toBe(tokens![i - 1].kind);
    }
    // Rejoining each side reproduces the original strings.
    expect(
      tokensForSide(tokens!, "before")
        .map((t) => t.text)
        .join(""),
    ).toBe("the quick brown fox");
    expect(
      tokensForSide(tokens!, "after")
        .map((t) => t.text)
        .join(""),
    ).toBe("the slow brown fox");
  });

  it("reports a prefix added to a sentence", () => {
    const tokens = diffWords(
      "A revision is not stored.",
      "Draft 13: A revision is not stored.",
    );
    expect(tokens!.filter((t) => t.kind === "removed")).toEqual([]);
    expect(
      tokens!
        .filter((t) => t.kind === "added")
        .map((t) => t.text)
        .join(""),
    ).toBe("Draft 13: ");
  });

  it("merges a run of changed words into one mark", () => {
    // "Draft 13: " is five tokens; it must render as one highlight, not five.
    const tokens = diffWords(
      "A revision is not stored.",
      "Draft 13: A revision is not stored.",
    )!;
    expect(tokens.filter((t) => t.kind === "added")).toEqual([
      { kind: "added", text: "Draft 13: " },
    ]);
    for (const side of ["before", "after"] as const) {
      const sided = tokensForSide(tokens, side);
      for (let i = 1; i < sided.length; i++) {
        expect(sided[i].kind).not.toBe(sided[i - 1].kind);
      }
    }
  });

  it("gives up rather than align two enormous lines", () => {
    const long = "word ".repeat(3000);
    expect(diffWords(long, `${long}tail`)).not.toBeNull(); // prefix-stripped
    const a = Array.from({ length: 2200 }, (_u, i) => `a${i}`).join(" ");
    const b = Array.from({ length: 2200 }, (_u, i) => `b${i}`).join(" ");
    expect(diffWords(a, b)).toBeNull();
  });
});

describe("similarity", () => {
  it("scores a rewrite high and unrelated sentences low", () => {
    expect(similarity("the quick brown fox", "the quick brown fox")).toBe(1);
    expect(
      similarity(
        "The reactor stores every action as an operation.",
        "Draft 13: The reactor stores every action as an operation, plainly.",
      ),
    ).toBeGreaterThan(0.5);
    expect(
      similarity("Undo is a skip count.", "Additions collapse into a tail."),
    ).toBeLessThan(0.3);
  });

  it("treats two blank lines as identical", () => {
    expect(similarity("", "")).toBe(1);
    expect(similarity("   ", "")).toBe(1);
  });
});

describe("collapseUnchanged", () => {
  const same = (n: number, prefix = "s") =>
    Array.from({ length: n }, (_u, i) => ({ kind: "same" as const, text: `${prefix}${i}` }));

  it("keeps short runs whole and folds long ones with context", () => {
    const lines = [
      ...same(10, "a"),
      { kind: "added" as const, text: "+" },
      ...same(2, "b"),
      { kind: "removed" as const, text: "-" },
      ...same(10, "c"),
    ];
    const out = collapseUnchanged(lines, 3);
    // leading run: no head context at start, 3 tail → gap of 7
    expect(out[0].kind).toBe("gap");
    expect((out[0] as DiffGap).hidden).toBe(7);
    expect(out.slice(1, 4).map((l) => (l as { text: string }).text)).toEqual(["a7", "a8", "a9"]);
    expect(out[4]).toEqual({ kind: "added", text: "+" });
    // middle short run kept whole
    expect(out.slice(5, 7).map((l) => (l as { text: string }).text)).toEqual(["b0", "b1"]);
    expect(out[7]).toEqual({ kind: "removed", text: "-" });
    // trailing run: 3 head context, no tail → gap of 7
    expect(out.slice(8, 11).map((l) => (l as { text: string }).text)).toEqual(["c0", "c1", "c2"]);
    expect((out[11] as DiffGap).hidden).toBe(7);
    expect(out.length).toBe(12);
  });

  it("keeps the hidden lines so a reader can expand them", () => {
    const out = collapseUnchanged(same(50), 3);
    expect(out).toHaveLength(1);
    const gap = out[0] as DiffGap;
    expect(gap.hidden).toBe(50);
    expect(gap.lines).toHaveLength(50);
    expect(gap.lines[0]).toEqual({ kind: "same", text: "s0" });
    expect(gap.lines[49]).toEqual({ kind: "same", text: "s49" });
  });
});

describe("toDiffRows", () => {
  it("pairs a rewritten line into one changed row", () => {
    const rows = toDiffRows(
      diffLines(
        "The reactor stores every action as an operation.",
        "Draft 13: The reactor stores every action as an operation.",
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("changed");
    const row = rows[0] as Extract<DiffRow, { kind: "changed" }>;
    expect(row.before).toContain("The reactor");
    expect(row.tokens?.some((t) => t.kind === "added")).toBe(true);
  });

  it("leaves unrelated removed and added lines unpaired", () => {
    const rows = toDiffRows(
      diffLines("Undo is a skip count.", "Additions collapse into a tail."),
    );
    expect(rows.map((r) => r.kind)).toEqual(["removed", "added"]);
  });

  it("handles runs of unequal length", () => {
    const rows = toDiffRows([
      { kind: "removed", text: "the quick brown fox" },
      { kind: "removed", text: "second removed line" },
      { kind: "added", text: "the quick red fox" },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["changed", "removed"]);
  });

  it("passes gaps and unchanged lines straight through", () => {
    const input: CollapsedLine[] = [
      { kind: "same", text: "kept" },
      { kind: "gap", hidden: 4, lines: [] },
      { kind: "added", text: "new line" },
    ];
    expect(toDiffRows(input)).toEqual(input);
  });
});
