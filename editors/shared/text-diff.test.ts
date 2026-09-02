import { describe, expect, it } from "vitest";
import { collapseUnchanged, diffLines, summarizeDiff } from "./text-diff.js";

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
    expect(out[0]).toEqual({ kind: "gap", hidden: 7 });
    expect(out.slice(1, 4).map((l) => (l as { text: string }).text)).toEqual(["a7", "a8", "a9"]);
    expect(out[4]).toEqual({ kind: "added", text: "+" });
    // middle short run kept whole
    expect(out.slice(5, 7).map((l) => (l as { text: string }).text)).toEqual(["b0", "b1"]);
    expect(out[7]).toEqual({ kind: "removed", text: "-" });
    // trailing run: 3 head context, no tail → gap of 7
    expect(out.slice(8, 11).map((l) => (l as { text: string }).text)).toEqual(["c0", "c1", "c2"]);
    expect(out[11]).toEqual({ kind: "gap", hidden: 7 });
    expect(out.length).toBe(12);
  });

  it("returns an all-same diff as a single gap when long", () => {
    const out = collapseUnchanged(same(50), 3);
    expect(out).toEqual([{ kind: "gap", hidden: 50 }]);
  });
});
