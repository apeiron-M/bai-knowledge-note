import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildSourceTimeline, type TimelineNode, type TimelineSource } from "../../../../processors/graph-indexer/source-timeline.js";
import { naturalWidth } from "../../lib/timeline/axis.js";
import { StrataChart, tipBox } from "./StrataChart.js";

const words = { locale: "en-US", timeZone: "UTC" };
const NOW = Date.parse("2026-10-16T10:18:00.000Z");
const iso = (s: string) => `2026-10-${s}Z`;

function source(id: string, folder: string, at: string, status = "EXTRACTED"): TimelineSource {
  return { id, parentFolder: folder, addedAt: at, batchAt: at, title: id, status, addedBy: null, sourceType: null, fileName: null, mimeType: "application/pdf", sizeBytes: null, method: "converted", tool: null, url: null, claimIds: [] };
}
function note(id: string, at: string): TimelineNode {
  return { documentId: id, documentType: "bai/knowledge-note", title: id, status: "IN_REVIEW", noteType: "concept", topics: [], addedAt: at, createdAt: at, sourceOrigin: "DERIVED" };
}
const report = Array.from({ length: 40 }, (_, i) => note(`r${i}`, iso(`10T20:${String(15 + (i % 40)).padStart(2, "0")}:00.000`)));
const book = Array.from({ length: 60 }, (_, i) => note(`b${i}`, iso(`15T19:${String(6 + (i % 50)).padStart(2, "0")}:00.000`)));
const timeline = buildSourceTimeline({
  sourcesFolderId: "root",
  folders: [{ id: "root", name: "sources", parentFolder: null }, { id: "fr", name: "State-of-AI-Report-2026", parentFolder: "root" }, { id: "fb", name: "Machine-Learning-Systems-Vol1", parentFolder: "root" }],
  sources: [source("sr", "fr", iso("10T20:14:00.000")), source("sb", "fb", iso("15T19:04:00.000"), "EXTRACTING")],
  nodes: [...report, ...book, { ...note("m1", iso("10T20:19:00.000")), documentType: "bai/moc", title: "AI safety" }],
  edges: [...report.map((n) => ({ source: n.documentId, target: "sr", type: "DERIVED_FROM" })), ...book.map((n) => ({ source: n.documentId, target: "sb", type: "DERIVED_FROM" })), { source: "m1", target: "r0", type: "CORE_IDEA" }],
});
const bookId = timeline.additions.find((a) => a.title === "Machine-Learning-Systems-Vol1")?.id as string;
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("StrataChart", () => {
  const html = renderToStaticMarkup(<StrataChart timeline={timeline} now={NOW} width={900} words={words} label="Notes over time" />);

  it("draws a layer per addition, labelled where it is thick enough, with the vault's folded time", () => {
    expect(html).toContain('aria-label="Notes over time"');
    expect(count(html, 'class="layer"')).toBe(2);
    expect(html).toContain("Machine-Learning-Systems-Vol1");
    expect(html).toContain("State-of-AI-Report-2026");
    expect(html).toContain(">5 days<");
    expect(html).toContain(">Now<");
    expect(html).toContain(">Sat, Oct 10<");
  });

  it("marks each topic where it was started", () => {
    expect(count(html, 'class="topic"')).toBe(1);
  });

  it("lights the addition that is open and dims the rest", () => {
    const picked = renderToStaticMarkup(<StrataChart timeline={timeline} now={NOW} width={900} words={words} label="x" selected={bookId} />);
    expect(picked).toContain('class="tl-strata picking"');
    expect(count(picked, 'class="layer on"')).toBe(1);
    expect(count(picked, 'class="edge on"')).toBe(1);
  });

  it("pulses on the addition still being read", () => {
    const live = renderToStaticMarkup(<StrataChart timeline={timeline} now={NOW} width={900} words={words} label="x" live={bookId} />);
    expect(live).toContain('class="livering"');
  });

  it("draws only the layers when compact, for the graph's dock", () => {
    const compact = renderToStaticMarkup(<StrataChart timeline={timeline} now={NOW} width={600} height={52} compact words={words} label="x" />);
    expect(count(compact, 'class="layer"')).toBe(2);
    expect(compact).not.toContain(">Now<");
    expect(compact).not.toContain('class="topic"');
    expect(compact).not.toContain('class="label"');
  });

  it("draws nothing it cannot measure", () => {
    expect(renderToStaticMarkup(<StrataChart timeline={timeline} now={NOW} width={0} words={words} label="x" />)).not.toContain("<path");
  });
});

describe("tipBox", () => {
  it("sits beside the pointer, never on it: right of it, or left of it near the right edge", () => {
    expect(tipBox(100, 900)).toEqual({ left: 116, width: 300 });
    expect(tipBox(850, 900)).toEqual({ left: 534, width: 300 });
    expect(tipBox(300, 600)).toEqual({ left: 316, width: 284 });
    expect(tipBox(420, 600)).toEqual({ left: 104, width: 300 });
    expect(tipBox(120, 240)).toEqual({ left: 0, width: 240 });
  });
});

describe("StrataChart, a long history", () => {
  // A feed every day for a year.
  const days = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2025, 9, 16 + i, 9)).toISOString());
  const year = buildSourceTimeline({
    sourcesFolderId: "root",
    folders: [{ id: "root", name: "sources", parentFolder: null }],
    sources: days.map((at, i) => source(`s${i}`, "root", at)),
    nodes: days.map((at, i) => note(`n${i}`, at)),
    edges: days.map((_, i) => ({ source: `n${i}`, target: `s${i}`, type: "DERIVED_FROM" })),
  });
  const html = renderToStaticMarkup(<StrataChart timeline={year} now={Date.UTC(2026, 9, 16, 12)} width={900} words={words} label="Notes over time" />);

  it("gives every day room and scrolls, rather than crushing a year into the panel", () => {
    expect(html).toContain('class="tl-scroll"');
    const drawn = Number(html.match(/<svg class="tl-strata[^"]*" viewBox="0 0 (\d+)/)?.[1]);
    expect(drawn).toBeGreaterThanOrEqual(365 * 80);
  });

  it("keeps the note counts readable while it scrolls", () => {
    expect(html).toContain('class="tl-yaxis"');
  });

  it("fits a short history in the panel, without scrolling", () => {
    const short = renderToStaticMarkup(<StrataChart timeline={timeline} now={NOW} width={900} words={words} label="Notes over time" />);
    expect(short).toMatch(/viewBox="0 0 900 /);
  });
});

describe("naturalWidth", () => {
  it("asks for room per day with arrivals, never less than the view", () => {
    const d = (n: number, h = 9) => Date.UTC(2026, 9, n, h);
    expect(naturalWidth([d(1), d(1, 15), d(2)], 900, { timeZone: "UTC" })).toBe(900);
    expect(naturalWidth(Array.from({ length: 30 }, (_, i) => d(1 + i)), 900, { timeZone: "UTC" })).toBe(30 * 80);
  });
});
