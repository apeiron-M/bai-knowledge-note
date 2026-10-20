// pieces/knowledge-vault/test/windows.test.ts
import { describe, expect, it } from "vitest";
import { draftBatchFor, HOSTED_WINDOW_CHARS, LOCAL_WINDOW_CHARS, MIN_WINDOW_CHARS, paceFor, splitInHalf, splitLong, WindowCursor, windowSize, type TextWindow } from "../lib/agent/windows.js";

/** A paragraph of exactly `chars` characters: "Paragraph N " then x's, ending with a full stop. */
const para = (n: number, chars = 1001) => {
  const head = `Paragraph ${n} `;
  return `${head}${"x".repeat(chars - head.length - 1)}.`;
};
const all = (cursor: WindowCursor, size: number) => {
  const out: TextWindow[] = [];
  for (let w = cursor.next(size); w; w = cursor.next(size)) out.push(w);
  return out;
};

describe("window size", () => {
  it("is 8,000 characters on a local model and 24,000 on a hosted one", () => {
    expect(windowSize({ locality: "local" })).toBe(LOCAL_WINDOW_CHARS);
    expect(windowSize({ locality: "hosted" })).toBe(HOSTED_WINDOW_CHARS);
    expect([paceFor("local"), paceFor("hosted")]).toEqual([1, 3]);
    expect([draftBatchFor("local"), draftBatchFor("hosted")]).toEqual([8, 16]);
  });
  it("is capped at a quarter of a known context, counting 3.5 characters per token", () => {
    expect(windowSize({ locality: "hosted", contextTokens: 16_000 })).toBe(14_000);
    expect(windowSize({ locality: "local", contextTokens: 32_768 })).toBe(8_000);
    expect(windowSize({ locality: "local", contextTokens: 1_000 })).toBe(MIN_WINDOW_CHARS);
  });
  it("takes an override, never below the minimum, and ignores one that is not a number", () => {
    expect(windowSize({ locality: "local", override: 12_000 })).toBe(12_000);
    expect(windowSize({ locality: "hosted", override: 500 })).toBe(MIN_WINDOW_CHARS);
    expect(windowSize({ locality: "local", override: null })).toBe(LOCAL_WINDOW_CHARS);
    expect(windowSize({ locality: "local", override: Number.NaN })).toBe(LOCAL_WINDOW_CHARS);
  });
});

describe("cutting windows", () => {
  it("breaks at paragraphs and stays within the size", () => {
    const text = [1, 2, 3, 4, 5].map((n) => para(n)).join("\n\n");
    const cursor = new WindowCursor(text);
    const windows = all(cursor, 2_500);
    expect(windows.map((w) => w.text.split("\n\n").length)).toEqual([2, 2, 1]);
    expect(windows.every((w) => w.text.length <= 2_500)).toBe(true);
    expect(windows.map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
    expect(cursor.done).toBe(true);
  });
  it("keeps a heading with the text under it, and gives each window the heading it falls under", () => {
    const text = ["# Hardware", para(1), para(2), "## Memory", para(3)].join("\n\n");
    const cursor = new WindowCursor(text);
    const first = cursor.next(2_100)!;
    expect(first.heading).toBe("Hardware");
    expect(first.text.startsWith("# Hardware")).toBe(true);
    expect(first.text).not.toContain("## Memory");
    const second = cursor.next(2_100)!;
    expect(second.heading).toBe("Memory");
    expect(second.text.startsWith("## Memory")).toBe(true);
  });
  it("cuts a paragraph longer than a window at sentence ends, losing no text", () => {
    const long = Array.from({ length: 60 }, (_, i) => `Sentence ${i} says something about inference costs.`).join(" ");
    const windows = all(new WindowCursor(long), MIN_WINDOW_CHARS);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows.every((w) => w.text.length <= MIN_WINDOW_CHARS)).toBe(true);
    expect(windows.every((w) => w.text.endsWith("."))).toBe(true);
    expect(windows.map((w) => w.text).join(" ").replace(/\s+/g, " ")).toBe(long);
  });
  it("cuts a source with no blank lines at all, as a PDF text layer often is", () => {
    const flat = "A claim about GPUs. ".repeat(1_000).trim();
    const sizes = all(new WindowCursor(flat), LOCAL_WINDOW_CHARS).map((w) => w.text.length);
    expect(sizes).toHaveLength(3);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(LOCAL_WINDOW_CHARS);
  });
  it("cuts a sentence longer than a window where it must", () => {
    expect(splitLong("y".repeat(5_000), 2_000).map((s) => s.length)).toEqual([2_000, 2_000, 1_000]);
  });
  it("hands out what is left as one window", () => {
    const cursor = new WindowCursor([para(1), para(2), para(3)].join("\n\n"));
    cursor.next(1_100);
    expect(cursor.rest()!.text.split("\n\n")).toHaveLength(2);
    expect(cursor.rest()).toBeNull();
  });
  it("splits a window in two near its middle, and not below the minimum", () => {
    const text = [1, 2, 3, 4, 5, 6].map((n) => para(n)).join("\n\n");
    const halves = splitInHalf({ id: "w4", heading: "Models", text })!;
    expect(halves.map((h) => h.id)).toEqual(["w4.1", "w4.2"]);
    expect(halves.map((h) => h.heading)).toEqual(["Models", "Models"]);
    expect(halves[0].text.split("\n\n")).toHaveLength(3);
    expect(`${halves[0].text}\n\n${halves[1].text}`).toBe(text);
    expect(splitInHalf({ id: "w1", heading: null, text: "x".repeat(2 * MIN_WINDOW_CHARS - 1) })).toBeNull();
  });
  it("halves a window near its middle even when one paragraph holds most of it", () => {
    const big = Array.from({ length: 160 }, (_, i) => `Sentence ${i} says something about memory.`).join(" ");
    const text = `Short intro sentence.\n\n${big}`;
    const halves = splitInHalf({ id: "w2", heading: null, text })!;
    expect(halves.map((h) => h.id)).toEqual(["w2.1", "w2.2"]);
    expect(Math.min(...halves.map((h) => h.text.length))).toBeGreaterThanOrEqual(MIN_WINDOW_CHARS);
    expect(Math.abs(halves[0].text.length - halves[1].text.length)).toBeLessThan(text.length * 0.2);
    expect(halves[0].text.endsWith(".")).toBe(true);
    expect(halves.map((h) => h.text).join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  });
});
