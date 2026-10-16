import { describe, expect, it } from "vitest";
import type { TimelineAddition, TimelineArrival } from "../../../../processors/graph-indexer/source-timeline.js";
import { foldedAxis } from "./axis.js";
import { bandAt, bandPaths, scaleY, stackStrata, strataLabels, strataLayers } from "./strata.js";

const H = 3_600_000;
const D = 24 * H;
const T = Date.UTC(2026, 9, 10, 20);
const iso = (ms: number) => new Date(ms).toISOString();

function addition(id: string, at: number, over: Partial<TimelineAddition> = {}): TimelineAddition {
  return {
    id, kind: "file", title: `Addition ${id}`, folderId: null, addedAt: iso(at), lastAddedAt: iso(at), addedBy: null,
    fileName: null, mimeType: null, sizeBytes: null, method: null, tool: null, url: null, sourceType: null,
    sources: 1, extracted: 1, waiting: 0, archived: 0, sourceIds: [], notes: 0, firstNoteAt: null, lastNoteAt: null,
    writtenFrom: null, topicIds: [], linksWithin: 0, linksToEarlier: 0, earlier: [], tags: [], topNotes: [], ...over,
  };
}
const arrivals = (additionId: string, from: number, count: number, every = 60_000): TimelineArrival[] =>
  Array.from({ length: count }, (_, i) => ({ documentId: `${additionId}-${i}`, addedAt: iso(from + i * every), writtenAt: null, additionId }));

describe("strataLayers", () => {
  it("makes one layer per addition with notes, oldest first", () => {
    const adds = [addition("b", T + D, { notes: 3 }), addition("a", T, { notes: 2 }), addition("empty", T + 2 * D)];
    const notes = [...arrivals("a", T, 2), ...arrivals("b", T + D, 3)];
    const layers = strataLayers(adds, notes);
    expect(layers.map((l) => [l.key, l.times.length, l.run])).toEqual([
      ["a", 2, false],
      ["b", 3, false],
    ]);
  });

  it("draws a run of small additions as one layer named by what dominates it", () => {
    const big = addition("book", T, { notes: 200, title: "Designing Data-Intensive Applications" });
    const feeds = [0, 1, 2].map((d) => addition(`feed${d}`, T + (d + 1) * D, { kind: "feed", tool: "rss", notes: 2 }));
    const paste = addition("paste", T + 4 * D, { kind: "text", notes: 1 });
    const notes = [...arrivals("book", T, 200, 1000), ...feeds.flatMap((f) => arrivals(f.id, Date.parse(f.addedAt), 2)), ...arrivals("paste", T + 4 * D, 1)];
    const layers = strataLayers([big, ...feeds, paste], notes, { locale: "en-US", timeZone: "UTC" });
    expect(layers.map((l) => [l.key, l.additionIds.length, l.times.length])).toEqual([
      ["book", 1, 200],
      ["run:feed0", 4, 7],
    ]);
    expect(layers[1].title).toBe("Mostly feeds, Oct 11 to Oct 14");
    expect(layers[1].run).toBe(true);
  });

  it("keeps a lone small addition as its own layer", () => {
    const adds = [addition("a", T, { notes: 100 }), addition("tiny", T + D, { notes: 1 }), addition("c", T + 2 * D, { notes: 100 })];
    const notes = [...arrivals("a", T, 100, 1000), ...arrivals("tiny", T + D, 1), ...arrivals("c", T + 2 * D, 100, 1000)];
    expect(strataLayers(adds, notes).map((l) => l.key)).toEqual(["a", "tiny", "c"]);
  });
});

describe("stackStrata", () => {
  const adds = [addition("a", T, { notes: 2 }), addition("b", T + 2 * H, { notes: 3 })];
  const notes = [...arrivals("a", T + 60_000, 2), ...arrivals("b", T + 2 * H + 60_000, 3)];
  const now = T + 3 * H;
  const ax = foldedAxis([T, T + 2 * H], 300, now);
  const stack = stackStrata(strataLayers(adds, notes), ax, 3);

  it("accumulates each layer's notes on top of the earlier ones", () => {
    const last = stack.xs.length - 1;
    expect(stack.bands.map((b) => [b.lo[last], b.hi[last]])).toEqual([
      [0, 2],
      [2, 5],
    ]);
    expect(stack.max).toBe(5);
    expect(stack.bands[1].hi[0]).toBe(0);
  });

  it("finds the band under a point", () => {
    const last = stack.xs.length - 1;
    expect(bandAt(stack, stack.xs[last], 1)).toBe(0);
    expect(bandAt(stack, stack.xs[last], 4)).toBe(1);
    expect(bandAt(stack, stack.xs[last], 9)).toBe(-1);
  });

  it("labels the layers thick enough to hold one, at now", () => {
    const labels = strataLabels(stack, { height: 200, top: 20, minPx: 17 });
    expect(labels.map((l) => l.band)).toEqual([0, 1]);
    expect(labels[1].y).toBeLessThan(labels[0].y);
    const thin = strataLabels(stack, { height: 40, top: 20, minPx: 17 });
    expect(thin).toEqual([]);
  });
});

describe("bandPaths", () => {
  it("draws each band as an area along its top and back along its bottom, and its top edge alone", () => {
    const adds = [addition("a", T, { notes: 2 }), addition("b", T + 2 * H, { notes: 3 })];
    const notes = [...arrivals("a", T + 60_000, 2), ...arrivals("b", T + 2 * H + 60_000, 3)];
    const ax = foldedAxis([T, T + 2 * H], 300, T + 3 * H);
    const stack = stackStrata(strataLayers(adds, notes), ax, 3);
    const y = scaleY(stack, 200, 20);
    const paths = bandPaths(stack, y);
    expect(paths).toHaveLength(2);
    const n = stack.xs.length;
    expect(paths[0].area.startsWith("M0,")).toBe(true);
    expect(paths[0].area.endsWith("Z")).toBe(true);
    expect(paths[0].area.split("L")).toHaveLength(2 * n);
    expect(paths[1].edge.split("L")).toHaveLength(n);
    // the top band's edge ends where the vault's total sits at now
    expect(paths[1].edge.endsWith(`${stack.xs[n - 1]},${y(5).toFixed(1)}`)).toBe(true);
  });
});
