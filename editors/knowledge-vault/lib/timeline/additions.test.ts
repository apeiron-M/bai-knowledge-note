import { describe, expect, it } from "vitest";
import type { SourceTimeline, TimelineAddition } from "../../../../processors/graph-indexer/source-timeline.js";
import {
  becameLine,
  clock,
  countOf,
  dayGroups,
  dayLabel,
  earlierLine,
  factsLine,
  filterAdditions,
  kindWord,
  liveAddition,
  pageGroups,
  progressLine,
  routeCounts,
  summaryParts,
  whoLabel,
} from "./additions.js";

const o = { locale: "en-US", timeZone: "UTC" };
const NOW = Date.UTC(2026, 9, 16, 10, 18);

function addition(over: Partial<TimelineAddition> = {}): TimelineAddition {
  return {
    id: "a", kind: "file", title: "Machine-Learning-Systems-Vol1", folderId: "f", addedAt: "2026-10-15T19:04:00.000Z",
    lastAddedAt: "2026-10-15T19:11:04.000Z", addedBy: "did:key:zDnaehqxKjBfsjh8RNCvsWcUhwB4QLqhGL7L5rwkXHBi3dtnU",
    fileName: "Machine-Learning-Systems-Vol1.pdf", mimeType: "application/pdf", sizeBytes: 12_197_035, method: "converted",
    tool: "docling.rs", url: null, sourceType: "ARTICLE", sources: 921, extracted: 70, waiting: 851, archived: 0, sourceIds: [],
    notes: 283, firstNoteAt: "2026-10-15T19:06:00.000Z", lastNoteAt: "2026-10-16T10:01:00.000Z", writtenFrom: null,
    topicIds: Array.from({ length: 18 }, (_, i) => `t${i}`), linksWithin: 391, linksToEarlier: 25, earlier: [], tags: [], topNotes: [], firstSources: [],
    ...over,
  };
}

describe("words for an addition", () => {
  it("names its kind by the file, the workflow or the writer", () => {
    expect(kindWord(addition())).toBe("PDF");
    expect(kindWord(addition({ fileName: "Inference Engineering.epub" }))).toBe("EPUB");
    expect(kindWord(addition({ kind: "feed", tool: "rss" }))).toBe("Feed");
    expect(kindWord(addition({ kind: "feed", tool: "arxiv" }))).toBe("Papers");
    expect(kindWord(addition({ kind: "feed", tool: "granola" }))).toBe("Meeting notes");
    expect(kindWord(addition({ kind: "feed", tool: "my-piece" }))).toBe("Workflow");
    expect(kindWord(addition({ kind: "agent" }))).toBe("Written by an agent");
    expect(kindWord(addition({ kind: "text", fileName: null }))).toBe("Text");
    expect(kindWord(addition({ kind: "written" }))).toBe("Written here");
    expect(kindWord(addition({ kind: "unsourced" }))).toBe("No source recorded");
  });

  it("says what an addition became, in a sentence", () => {
    expect(becameLine(addition())).toBe("921 sources became 283 notes so far, in 18 new topics.");
    expect(becameLine(addition({ sources: 6, waiting: 0, notes: 26, topicIds: ["t"] }))).toBe("6 sources became 26 notes, in 1 new topic.");
    expect(becameLine(addition({ sources: 1, waiting: 0, notes: 21, topicIds: [] }))).toBe("1 source became 21 notes.");
    expect(becameLine(addition({ kind: "agent", sources: 6, waiting: 0, notes: 64, topicIds: ["a", "b"] }))).toBe("6 chapters written by an agent became 64 notes, in 2 new topics.");
    expect(becameLine(addition({ kind: "feed", tool: "rss", sources: 3, waiting: 0, notes: 4, topicIds: [] }))).toBe("3 posts became 4 notes.");
    expect(becameLine(addition({ notes: 0, extracted: 0, waiting: 921 }))).toBe("921 sources, waiting to be read.");
    expect(becameLine(addition({ sources: 2, notes: 0, waiting: 0 }))).toBe("2 sources read; none became a note.");
    expect(becameLine(addition({ kind: "written", sources: 0, notes: 1, topicIds: [] }))).toBe("1 note written in the vault, not drawn from a source.");
    expect(becameLine(addition({ kind: "unsourced", sources: 0, notes: 2, topicIds: [] }))).toBe(
      "2 notes have no recorded source. It may have been removed, or the notes were added without one.",
    );
    expect(becameLine(addition({ kind: "unsourced", sources: 0, notes: 1, topicIds: [] }))).toBe(
      "1 note has no recorded source. It may have been removed, or the note was added without one.",
    );
    expect(becameLine(addition({ kind: "imported", sources: 0, notes: 12, topicIds: [] }))).toBe("12 notes imported, with no source in this vault.");
    expect(becameLine(addition({ kind: "imported", sources: 0, notes: 1, topicIds: ["t"] }))).toBe("1 note imported, with no source in this vault.");
    expect(kindWord(addition({ kind: "imported" }))).toBe("Imported");
  });

  it("says how far the reading has got, and that more arrives while it is live", () => {
    expect(progressLine(addition(), true)).toBe("70 of 921 extracted, more arriving now");
    expect(progressLine(addition({ sources: 19, extracted: 4, waiting: 15 }), false)).toBe("4 of 19 extracted, 15 waiting");
    expect(progressLine(addition({ waiting: 0 }), false)).toBeNull();
  });

  it("says how it linked to what came before", () => {
    expect(earlierLine(addition())).toBe("25 links to notes from earlier additions");
    expect(earlierLine(addition({ linksToEarlier: 1 }))).toBe("1 link to notes from earlier additions");
    expect(earlierLine(addition({ linksToEarlier: 0 }))).toBeNull();
  });

  it("states the facts: when, by whom, which file, the split and the written date", () => {
    const me = "did:key:zDnaehqxKjBfsjh8RNCvsWcUhwB4QLqhGL7L5rwkXHBi3dtnU";
    expect(factsLine(addition(), NOW, { ...o, me })).toBe(
      "Added on Thursday, October 15 at 7:04 PM by you. File: Machine-Learning-Systems-Vol1.pdf, 11.6 MB. Split into 921 sources in 7 minutes.",
    );
    expect(factsLine(addition({ kind: "unsourced", fileName: null, sizeBytes: null, sources: 0, addedBy: null, writtenFrom: "2026-09-17T11:10:22.000Z" }), NOW, o)).toBe(
      "Arrived on Thursday, October 15 at 7:04 PM. Its notes were written on September 17, before they came into this vault.",
    );
  });

  it("leaves out who added it when the vault has one contributor", () => {
    expect(factsLine(addition(), NOW, { ...o, who: false })).toBe(
      "Added on Thursday, October 15 at 7:04 PM. File: Machine-Learning-Systems-Vol1.pdf, 11.6 MB. Split into 921 sources in 7 minutes.",
    );
  });

  it("shortens who added it, and says you when it was you", () => {
    expect(whoLabel("did:key:zDnaehqxKjBfsjh8RNCvsWcUhwB4QLqhGL7L5rwkXHBi3dtnU", null)).toBe("did:key:zDna…3dtnU");
    expect(whoLabel("0x1234567890abcdef1234567890abcdef12345678", null)).toBe("0x1234…5678");
    expect(whoLabel("0xabc", "0xABC")).toBe("you");
    expect(whoLabel(null, null)).toBeNull();
  });

  it("counts with the thousands grouped", () => {
    expect(countOf(1044, "source")).toBe("1,044 sources");
    expect(countOf(1, "topic")).toBe("1 topic");
    expect(countOf(3, "match", "matches")).toBe("3 matches");
  });
});

describe("the timeline as a whole", () => {
  const ml = addition();
  const guide = addition({ id: "g", kind: "text", title: "How Knowledge Vault works", addedAt: "2026-10-10T19:20:00.000Z", sources: 1, extracted: 1, waiting: 0, notes: 21, topicIds: ["x"], lastNoteAt: "2026-10-10T19:23:00.000Z" });
  const report = addition({ id: "r", title: "State of AI Report 2026", addedAt: "2026-10-10T20:14:00.000Z", sources: 74, extracted: 48, waiting: 26, notes: 122, lastNoteAt: "2026-10-10T21:19:00.000Z" });
  const orphans = addition({ id: "o", kind: "unsourced", title: "Notes with no recorded source", addedAt: "2026-10-15T13:58:09.000Z", sources: 0, waiting: 0, notes: 2, topicIds: [] });
  const timeline: SourceTimeline = {
    additions: [guide, report, orphans, ml],
    notes: [],
    topics: Array.from({ length: 46 }, (_, i) => ({ documentId: `t${i}`, title: `T${i}`, addedAt: null, writtenAt: null, additionId: null })),
    totals: { sources: 996, notes: 428, topics: 46, links: 778 },
  };

  it("finds the addition still being read: waiting sources and the newest note", () => {
    expect(liveAddition(timeline.additions, NOW)).toBe("a");
    expect(liveAddition([guide], NOW)).toBeNull();
  });

  it("stops calling an addition live when no note has arrived for an hour", () => {
    expect(liveAddition([ml], Date.parse("2026-10-16T11:00:00.000Z"))).toBe("a");
    expect(liveAddition([ml], Date.parse("2026-10-16T11:02:00.000Z"))).toBeNull();
  });

  it("sums it up in one sentence, with the numbers that matter in bold", () => {
    const parts = summaryParts(timeline, "a", NOW, o);
    expect(parts.map((p) => p.text).join("")).toBe(
      "Since Saturday, October 10, 3 additions became 426 notes in 46 topics; 2 notes have no recorded source. Machine-Learning-Systems-Vol1 is still being read, so its layer is still growing.",
    );
    expect(parts.filter((p) => p.strong).map((p) => p.text)).toEqual(["3 additions", "426 notes", "46 topics"]);
  });

  it("names notes written here and imported notes, and counts notes with no date rather than losing them", () => {
    const written = addition({ id: "w", kind: "written", title: "Notes written in the vault", addedAt: "2026-10-16T09:00:00.000Z", sources: 0, waiting: 0, notes: 3, topicIds: [] });
    const imported = addition({ id: "i", kind: "imported", title: "Imported notes", addedAt: "2026-10-15T14:20:00.000Z", sources: 0, waiting: 0, notes: 12, topicIds: [] });
    const undated = [{ documentId: "u1", addedAt: null, writtenAt: null, additionId: null }, { documentId: "u2", addedAt: null, writtenAt: null, additionId: null }];
    const t: SourceTimeline = { ...timeline, additions: [...timeline.additions, written, imported], notes: undated };
    expect(summaryParts(t, null, NOW, o).map((p) => p.text).join("")).toBe(
      "Since Saturday, October 10, 3 additions became 426 notes in 46 topics, and 3 notes were written here and 12 notes were imported; 2 notes have no recorded source; 2 notes have no recorded date.",
    );
    const onlyImported: SourceTimeline = { ...timeline, additions: [imported], notes: [] };
    expect(summaryParts(onlyImported, null, NOW, o).map((p) => p.text).join("")).toBe("12 notes were imported.");
    expect(routeCounts([imported, written, orphans])).toEqual([
      ["written", 1],
      ["imported", 1],
      ["unsourced", 1],
    ]);
  });

  it("groups additions by day, newest first, with each day's notes", () => {
    const groups = dayGroups(timeline.additions, NOW, o);
    expect(groups.map((g) => [g.label, g.additions.map((a) => a.id), g.notes])).toEqual([
      ["Yesterday", ["a", "o"], 285],
      ["Saturday, October 10", ["r", "g"], 143],
    ]);
  });

  it("counts additions by route for the filter chips, and filters by route and name", () => {
    expect(routeCounts(timeline.additions)).toEqual([
      ["files", 2],
      ["text", 1],
      ["unsourced", 1],
    ]);
    expect(filterAdditions(timeline.additions, "files", "").map((a) => a.id)).toEqual(["r", "a"]);
    expect(filterAdditions(timeline.additions, "all", "state of").map((a) => a.id)).toEqual(["r"]);
  });

  it("labels days the way people say them", () => {
    expect(dayLabel(NOW, NOW, o)).toBe("Today");
    expect(dayLabel(NOW - 86_400_000, NOW, o)).toBe("Yesterday");
    expect(dayLabel(Date.UTC(2026, 9, 10, 20), NOW, o)).toBe("Saturday, October 10");
    expect(dayLabel(Date.UTC(2025, 9, 10, 20), NOW, o)).toBe("Friday, October 10, 2025");
    expect(clock(Date.UTC(2026, 9, 15, 19, 4), o)).toBe("7:04 PM");
  });
});

describe("pageGroups", () => {
  const group = (key: string, n: number) => ({ key, label: key, notes: 0, additions: Array.from({ length: n }, (_, i) => addition({ id: `${key}-${i}` })) });
  const groups = [group("d1", 3), group("d2", 40), group("d3", 30), group("d4", 10)];

  it("shows whole days, newest first, until about a page of rows", () => {
    const page = pageGroups(groups, 60);
    expect(page.shown.map((g) => g.key)).toEqual(["d1", "d2", "d3"]);
    expect(page.hiddenAdditions).toBe(10);
  });

  it("always shows the day holding the opened addition, and says how many rows that took", () => {
    const page = pageGroups(groups, 60, "d4-7");
    expect(page.shown.map((g) => g.key)).toEqual(["d1", "d2", "d3", "d4"]);
    expect(page.hiddenAdditions).toBe(0);
    expect(page.rowsShown).toBe(83);
    expect(pageGroups(groups, 60).rowsShown).toBe(73);
  });

  it("shows at least one day, however long it is", () => {
    expect(pageGroups([group("big", 500)], 60).shown).toHaveLength(1);
    expect(pageGroups([], 60)).toEqual({ shown: [], hiddenAdditions: 0, rowsShown: 0 });
  });
});
