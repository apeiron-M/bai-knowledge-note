import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildSourceTimeline, type TimelineNode, type TimelineSource } from "../../../../processors/graph-indexer/source-timeline.js";
import { TimeDock } from "./TimeDock.js";

const words = { locale: "en-US", timeZone: "UTC" };
const NOW = Date.parse("2026-10-16T10:18:00.000Z");
const noop = () => {};
const source = (id: string, folder: string, at: string): TimelineSource => ({ id, parentFolder: folder, addedAt: at, batchAt: at, title: id, status: "EXTRACTING", addedBy: null, sourceType: null, fileName: null, mimeType: "application/pdf", sizeBytes: null, method: "converted", tool: null, url: null, claimIds: [] });
const note = (id: string, at: string): TimelineNode => ({ documentId: id, documentType: "bai/knowledge-note", title: id, status: "IN_REVIEW", noteType: "concept", topics: [], addedAt: at, createdAt: at, sourceOrigin: "DERIVED" });
const timeline = buildSourceTimeline({
  sourcesFolderId: "root",
  folders: [{ id: "root", name: "sources", parentFolder: null }, { id: "fb", name: "Machine-Learning-Systems-Vol1", parentFolder: "root" }],
  sources: [source("sb", "fb", "2026-10-15T19:04:00.000Z")],
  nodes: [note("n1", "2026-10-15T19:10:00.000Z"), note("n2", "2026-10-15T19:20:00.000Z"), { ...note("m", "2026-10-15T19:30:00.000Z"), documentType: "bai/moc", title: "ML Systems" }],
  edges: [{ source: "n1", target: "sb", type: "DERIVED_FROM" }, { source: "n2", target: "sb", type: "DERIVED_FROM" }, { source: "m", target: "n1", type: "CORE_IDEA" }],
});
const book = timeline.additions[0].id;

describe("TimeDock", () => {
  const html = renderToStaticMarkup(<TimeDock timeline={timeline} now={NOW} words={words} pick={null} trackWidth={600} onMoment={noop} onShowEverything={noop} />);

  it("opens at now, narrating the latest arrival and counting what exists", () => {
    expect(html).toContain("7:04 PM, Machine-Learning-Systems-Vol1 arrives");
    expect(html).toContain("as 1 source. 2 notes from it by this moment.");
    expect(html).toContain(">Now<");
    expect(html).toMatch(/<b>2<\/b> notes/);
    expect(html).toMatch(/<b>1<\/b> topic/);
  });

  it("is a slider over the strata, with a play button", () => {
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('aria-label="Play"');
    expect(html).toContain('class="tl-strata"');
  });

  it("says what one addition became when it was opened from the timeline, with a way back to everything", () => {
    const picked = renderToStaticMarkup(<TimeDock timeline={timeline} now={NOW} words={words} pick={book} trackWidth={600} onMoment={noop} onShowEverything={noop} />);
    expect(picked).toContain("What Machine-Learning-Systems-Vol1 became.");
    expect(picked).toContain("2 notes in 1 new topic.");
    expect(picked).toContain("Show everything");
    expect(picked).toContain('class="tl-strata picking"');
  });
});

describe("TimeDock, for a screen reader", () => {
  const html = renderToStaticMarkup(<TimeDock timeline={timeline} now={NOW} words={words} pick={null} trackWidth={600} onMoment={noop} onShowEverything={noop} />);

  it("announces only what arrives, not every frame's counts", () => {
    const live = html.match(/<span class="tl-sr" aria-live="polite">([^<]*)<\/span>/);
    expect(live?.[1]).toBe("7:04 PM, Machine-Learning-Systems-Vol1 arrives");
    expect(html).not.toMatch(/class="tl-dock-caption"[^>]*aria-live/);
  });
});

describe("TimeDock, narrow", () => {
  it("keeps Show everything outside the caption, which may be clamped", () => {
    const html = renderToStaticMarkup(<TimeDock timeline={timeline} now={NOW} words={words} pick={book} trackWidth={300} onMoment={noop} onShowEverything={noop} />);
    const caption = html.match(/<p class="tl-dock-caption">(.*?)<\/p>/)?.[1] ?? "";
    expect(caption).not.toContain("Show everything");
    expect(html).toContain(">Show everything</button>");
  });
});
