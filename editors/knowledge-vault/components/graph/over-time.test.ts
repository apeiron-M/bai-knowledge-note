import { describe, expect, it } from "vitest";
import type { SourceTimeline } from "../../../../processors/graph-indexer/source-timeline.js";
import { foldedAxis } from "../../lib/timeline/axis.js";
import type { Visibility } from "./model.js";
import { additionMembers, arrivalArray, arrivalsOf, arrivedWithin, countsAt, maskByTime, momentCaption, pickCaption } from "./over-time.js";

const words = { locale: "en-US", timeZone: "UTC" };
const T = (s: string) => Date.parse(`2026-10-${s}Z`);
const NOW = T("16T10:18:00.000");

// a, b: notes; m: a topic; x: a node the timeline does not know (a tension, say)
const g = {
  nodes: [{ id: "a" }, { id: "b" }, { id: "m" }, { id: "x" }],
  links: [{}, {}, {}],
  src: Uint32Array.from([2, 2, 0]),
  dst: Uint32Array.from([0, 1, 1]),
};

const timeline: SourceTimeline = {
  additions: [
    { id: "r", kind: "file", title: "State-of-AI-Report-2026", folderId: "f", addedAt: "2026-10-10T20:14:00.000Z", lastAddedAt: "2026-10-10T20:14:00.000Z", addedBy: null, fileName: null, mimeType: "application/pdf", sizeBytes: null, method: null, tool: null, url: null, sourceType: null, sources: 74, extracted: 74, waiting: 0, archived: 0, sourceIds: [], notes: 1, firstNoteAt: null, lastNoteAt: null, writtenFrom: null, topicIds: ["m"], linksWithin: 0, linksToEarlier: 0, earlier: [], tags: [], topNotes: [], firstSources: [] },
    { id: "ml", kind: "file", title: "Machine-Learning-Systems-Vol1", folderId: "g", addedAt: "2026-10-15T19:04:00.000Z", lastAddedAt: "2026-10-15T19:11:00.000Z", addedBy: null, fileName: null, mimeType: "application/pdf", sizeBytes: null, method: null, tool: null, url: null, sourceType: null, sources: 921, extracted: 70, waiting: 851, archived: 0, sourceIds: [], notes: 1, firstNoteAt: null, lastNoteAt: null, writtenFrom: null, topicIds: [], linksWithin: 0, linksToEarlier: 1, earlier: [{ additionId: "r", links: 1 }], tags: [], topNotes: [], firstSources: [] },
  ],
  notes: [
    { documentId: "a", addedAt: "2026-10-10T20:15:00.000Z", writtenAt: null, additionId: "r" },
    { documentId: "b", addedAt: "2026-10-15T19:30:00.000Z", writtenAt: null, additionId: "ml" },
  ],
  topics: [{ documentId: "m", title: "AI safety", addedAt: "2026-10-10T20:19:00.000Z", writtenAt: null, additionId: "r" }],
  totals: { sources: 995, notes: 2, topics: 1, links: 1 },
};

describe("arrival times on the graph", () => {
  it("knows when each note and topic arrived, and leaves the rest unknown", () => {
    const at = arrivalArray(g, arrivalsOf(timeline));
    expect([...at].slice(0, 3)).toEqual([T("10T20:15:00.000"), T("15T19:30:00.000"), T("10T20:19:00.000")]);
    expect(Number.isNaN(at[3])).toBe(true);
  });
});

describe("maskByTime", () => {
  const at = arrivalArray(g, arrivalsOf(timeline));

  it("treats what the timeline does not know as arriving at the dock's now: hidden in the past, shown at the end", () => {
    const withNow = arrivalArray(g, arrivalsOf(timeline), NOW);
    expect(withNow[3]).toBe(NOW);
    expect([...maskByTime(g, null, withNow, T("16T09:00:00.000"), null).node]).toEqual([1, 1, 1, 0]);
    expect([...maskByTime(g, null, withNow, NOW, null).node]).toEqual([1, 1, 1, 1]);
  });

  it("shows what existed at the moment, and a link only when both ends do; the unknown always shows", () => {
    const v = maskByTime(g, null, at, T("12T00:00:00.000"), null);
    expect([...v.node]).toEqual([1, 0, 1, 1]);
    expect([...v.edge]).toEqual([1, 0, 0]);
  });

  it("narrows the legend's own mask rather than widening it", () => {
    const legend: Visibility = { node: Uint8Array.from([0, 1, 1, 1]), edge: Uint8Array.from([0, 1, 0]) };
    const v = maskByTime(g, legend, at, NOW, null);
    expect([...v.node]).toEqual([0, 1, 1, 1]);
    expect([...v.edge]).toEqual([0, 1, 0]);
  });

  it("reuses spare arrays that fit, so scrubbing allocates nothing", () => {
    const spare: Visibility = { node: new Uint8Array(4), edge: new Uint8Array(3) };
    expect(maskByTime(g, null, at, NOW, spare)).toBe(spare);
  });
});

describe("arrivedWithin", () => {
  it("lists what arrived in the window before the moment and is shown", () => {
    const at = arrivalArray(g, arrivalsOf(timeline));
    expect(arrivedWithin(at, T("10T20:20:00.000"), 30 * 60_000, null)).toEqual([0, 2]);
    const hidden: Visibility = { node: Uint8Array.from([1, 1, 0, 1]), edge: new Uint8Array(3) };
    expect(arrivedWithin(at, T("10T20:20:00.000"), 30 * 60_000, hidden)).toEqual([0]);
  });
});

describe("what one addition became", () => {
  it("collects its notes and the topics credited to it", () => {
    expect([...additionMembers(timeline, "r")].sort()).toEqual(["a", "m"]);
    expect([...additionMembers(timeline, "ml")]).toEqual(["b"]);
  });

  it("says plainly when the addition has nothing in the graph yet", () => {
    const waiting = { ...timeline.additions[1], id: "w", title: "Fresh-Upload", notes: 0, topicIds: [], linksToEarlier: 0, waiting: 12 };
    const read = { ...waiting, id: "e", title: "Empty-Report", waiting: 0 };
    const t: SourceTimeline = { ...timeline, additions: [...timeline.additions, waiting, read] };
    expect(pickCaption(t, "w")).toEqual({ lead: "Nothing from Fresh-Upload is in the graph yet.", rest: "Its sources are waiting to be read." });
    expect(pickCaption(t, "e")).toEqual({ lead: "Nothing from Empty-Report is in the graph.", rest: "None of its sources became a note." });
  });

  it("says so in one line", () => {
    expect(pickCaption(timeline, "ml")).toEqual({ lead: "What Machine-Learning-Systems-Vol1 became.", rest: "1 note, with 1 link to notes from earlier additions." });
    expect(pickCaption(timeline, "r")).toEqual({ lead: "What State-of-AI-Report-2026 became.", rest: "1 note in 1 new topic." });
    expect(pickCaption(timeline, "nope")).toBeNull();
  });
});

describe("the dock's words", () => {
  const ax = foldedAxis([T("10T20:14:00.000"), T("10T20:20:00.000"), T("15T19:04:00.000"), T("15T19:30:00.000")], 600, NOW);

  it("narrates the latest arrival at the moment", () => {
    expect(momentCaption(timeline, ax, T("15T19:42:00.000"), NOW, words)).toEqual({
      lead: "7:04 PM, Machine-Learning-Systems-Vol1 arrives",
      rest: "as 921 sources. 1 note from it by this moment.",
    });
  });

  it("names a quiet stretch, and the time before anything arrived", () => {
    expect(momentCaption(timeline, ax, T("13T00:00:00.000"), NOW, words)).toEqual({ lead: "5 quiet days.", rest: "Nothing was added; the vault kept what it had." });
    expect(momentCaption(timeline, ax, T("10T19:00:00.000"), NOW, words)).toEqual({ lead: "Before anything was added.", rest: "Press play to watch the vault fill." });
  });

  it("counts the notes and topics that existed", () => {
    expect(countsAt(timeline, T("12T00:00:00.000"))).toEqual({ notes: 1, topics: 1 });
    expect(countsAt(timeline, NOW)).toEqual({ notes: 2, topics: 1 });
  });
});
