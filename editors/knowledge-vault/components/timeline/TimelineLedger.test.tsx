import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SourceTimeline, TimelineAddition } from "../../../../processors/graph-indexer/source-timeline.js";
import { dayGroups } from "../../lib/timeline/additions.js";
import { AdditionDetail } from "./AdditionDetail.js";
import { TimelineLedger } from "./TimelineLedger.js";

const words = { locale: "en-US", timeZone: "UTC" };
const NOW = Date.parse("2026-10-16T10:18:00.000Z");

function addition(over: Partial<TimelineAddition>): TimelineAddition {
  return {
    id: "a", kind: "file", title: "Machine-Learning-Systems-Vol1", folderId: "f", addedAt: "2026-10-15T19:04:00.000Z", lastAddedAt: "2026-10-15T19:11:04.000Z",
    addedBy: "0x1234567890abcdef1234567890abcdef12345678", fileName: "Machine-Learning-Systems-Vol1.pdf", mimeType: "application/pdf", sizeBytes: 12_197_035,
    method: "converted", tool: "docling.rs", url: null, sourceType: "ARTICLE", sources: 921, extracted: 70, waiting: 851, archived: 0, sourceIds: [],
    notes: 283, firstNoteAt: null, lastNoteAt: "2026-10-16T10:01:00.000Z", writtenFrom: null, topicIds: ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"],
    linksWithin: 391, linksToEarlier: 19, earlier: [{ additionId: "e", links: 16 }, { additionId: "g", links: 3 }], tags: [{ name: "ML systems engineering", count: 160 }],
    topNotes: [{ documentId: "n1", title: "ML system optimization must treat data, algorithms, and hardware as coupled choices." }],
    ...over,
  };
}
const book = addition({});
const epub = addition({ id: "e", title: "Inference Engineering", fileName: "Inference Engineering.epub", addedAt: "2026-10-15T12:48:00.000Z", sources: 19, extracted: 4, waiting: 15, notes: 36, topicIds: [], linksToEarlier: 0, earlier: [] });
const guide = addition({ id: "g", kind: "text", title: "How Knowledge Vault works", fileName: null, mimeType: null, sizeBytes: null, addedAt: "2026-10-10T19:20:00.000Z", sources: 1, extracted: 1, waiting: 0, notes: 21, topicIds: [], linksToEarlier: 0, earlier: [] });
const orphans = addition({ id: "o", kind: "unsourced", title: "Notes with no recorded source", folderId: null, addedAt: "2026-10-15T13:58:09.000Z", sources: 0, waiting: 0, notes: 2, topicIds: [], linksToEarlier: 0, earlier: [], fileName: null });
const timeline: SourceTimeline = {
  additions: [guide, epub, orphans, book],
  notes: [],
  topics: ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"].map((id, i) => ({ documentId: id, title: `Topic ${i + 1}`, addedAt: null, writtenAt: null, additionId: "a" })),
  totals: { sources: 941, notes: 342, topics: 8, links: 400 },
};
const noop = () => {};

describe("TimelineLedger", () => {
  const render = (selected: string | null) =>
    renderToStaticMarkup(
      <TimelineLedger groups={dayGroups(timeline.additions, NOW, words)} words={words} live="a" selected={selected} hovered={null} onPick={noop} onHover={noop} renderDetail={(a) => <div className="detail-for">{a.id}</div>} />,
    );

  it("lists additions by day, newest first, each with its time and what it became", () => {
    const html = render(null);
    expect(html.indexOf("Yesterday")).toBeLessThan(html.indexOf("Saturday, October 10"));
    expect(html).toContain("3 additions, 321 notes");
    expect(html).toContain(">7:04 PM<");
    expect(html).toContain("921 sources became 283 notes so far, in 8 new topics.");
    expect(html).toContain("19 links to notes from earlier additions");
    expect(html).toContain("1 source became 21 notes.");
    expect(html).toContain("No source recorded");
  });

  it("shows how far the reading has got, live for the addition being read", () => {
    const html = render(null);
    expect(html).toContain("70 of 921 extracted, more arriving now");
    expect(html).toContain("4 of 19 extracted, 15 waiting");
    expect(html).toContain('class="tl-row live"');
  });

  it("opens one row, and says so to assistive technology", () => {
    const html = render("a");
    expect(html).toContain('class="detail-for">a<');
    expect(html.split('aria-expanded="true"')).toHaveLength(2);
    expect(html).toContain('class="tl-row live open"');
  });
});

describe("AdditionDetail", () => {
  const html = renderToStaticMarkup(
    <AdditionDetail addition={book} timeline={timeline} now={NOW} words={words} me={null} onShowInGraph={noop} onOpenSources={noop} onOpenDocument={noop} />,
  );

  it("states the facts", () => {
    expect(html).toContain("Added on Thursday, October 15 at 7:04 PM by 0x1234…5678. File: Machine-Learning-Systems-Vol1.pdf, 11.6 MB. Split into 921 sources in 7 minutes.");
  });

  it("lists the topics it started, the first six and how many more", () => {
    expect(html).toContain("Topic 1");
    expect(html).toContain("Topic 6");
    expect(html).not.toContain("Topic 7");
    expect(html).toContain("and 2 more topics");
    expect(html).toContain("#ML systems engineering");
  });

  it("says how it connected to each earlier addition, and among its own notes", () => {
    expect(html).toContain("<b>16</b> to Inference Engineering");
    expect(html).toContain("<b>3</b> to How Knowledge Vault works");
    expect(html).toContain("391 links among its own notes.");
  });

  it("offers its most linked notes and the next steps", () => {
    expect(html).toContain("ML system optimization must treat data");
    expect(html).toContain("Show in graph");
    expect(html).toContain("Open its sources");
  });

  it("opens a lone pasted source itself, not the whole of /sources", () => {
    const pasted = renderToStaticMarkup(
      <AdditionDetail addition={{ ...guide, folderId: null, sourceIds: ["s-guide"] }} timeline={timeline} now={NOW} words={words} me={null} onShowInGraph={noop} onOpenSources={noop} onOpenDocument={noop} />,
    );
    expect(pasted).not.toContain("Open its sources");
    expect(pasted).toContain("Open the source");
  });

  it("has nothing to open for notes without a source", () => {
    const loose = renderToStaticMarkup(
      <AdditionDetail addition={orphans} timeline={timeline} now={NOW} words={words} me={null} onShowInGraph={noop} onOpenSources={noop} onOpenDocument={noop} />,
    );
    expect(loose).not.toContain("Open its sources");
    expect(loose).toContain("None yet. Its notes joined topics that already existed.");
    expect(loose).toContain("No links to earlier notes yet.");
  });
});
