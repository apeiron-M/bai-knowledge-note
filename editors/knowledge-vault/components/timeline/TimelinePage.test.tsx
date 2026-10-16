import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildSourceTimeline, type TimelineNode, type TimelineSource } from "../../../../processors/graph-indexer/source-timeline.js";
import { TimelinePage, type TimelinePageProps } from "./TimelinePage.js";

const words = { locale: "en-US", timeZone: "UTC" };
const NOW = Date.parse("2026-10-16T10:18:00.000Z");
const noop = () => {};

function source(id: string, folder: string, at: string, over: Partial<TimelineSource> = {}): TimelineSource {
  return { id, parentFolder: folder, addedAt: at, batchAt: at, title: id, status: "EXTRACTED", addedBy: "did:key:me", sourceType: null, fileName: null, mimeType: "application/pdf", sizeBytes: null, method: "converted", tool: null, url: null, claimIds: [], ...over };
}
const note = (id: string, at: string): TimelineNode => ({ documentId: id, documentType: "bai/knowledge-note", title: id, status: "IN_REVIEW", noteType: "concept", topics: [], addedAt: at, createdAt: at, sourceOrigin: "DERIVED" });
const notes = [note("n1", "2026-10-10T20:20:00.000Z"), note("n2", "2026-10-15T19:10:00.000Z"), note("n3", "2026-10-15T19:12:00.000Z")];
const timeline = buildSourceTimeline({
  sourcesFolderId: "root",
  folders: [{ id: "root", name: "sources", parentFolder: null }, { id: "fa", name: "State-of-AI-Report-2026", parentFolder: "root" }, { id: "fb", name: "Machine-Learning-Systems-Vol1", parentFolder: "root" }],
  sources: [source("sa", "fa", "2026-10-10T20:14:00.000Z"), source("sb", "fb", "2026-10-15T19:04:00.000Z", { status: "EXTRACTING" }), source("sb2", "fb", "2026-10-15T19:05:00.000Z")],
  nodes: notes,
  edges: [{ source: "n1", target: "sa", type: "DERIVED_FROM" }, { source: "n2", target: "sb", type: "DERIVED_FROM" }, { source: "n3", target: "sb2", type: "DERIVED_FROM" }],
});

function render(over: Partial<TimelinePageProps> = {}) {
  return renderToStaticMarkup(
    <TimelinePage timeline={timeline} isLoading={false} error={null} mode="server" now={NOW} words={words} chartWidth={900} onAddSources={noop} onShowInGraph={noop} onOpenSources={noop} onOpenDocument={noop} {...over} />,
  );
}

describe("TimelinePage", () => {
  it("sums the vault up, then draws the strata and lists every addition", () => {
    const html = render();
    expect(html).toContain("<style");
    expect(html).toContain("Since Saturday, October 10, ");
    expect(html).toContain("<b>2 additions</b>");
    expect(html).toContain("<b>3 notes</b>");
    expect(html).toContain('class="tl-strata"');
    expect(html).toContain("Notes, in layers by the addition they came from");
    expect(html).toContain("Machine-Learning-Systems-Vol1");
    expect(html).toContain("State-of-AI-Report-2026");
    expect(html).toContain("Yesterday");
  });

  it("offers a chip per route that has additions, all of them pressed by default", () => {
    const html = render();
    expect(html).toMatch(/aria-pressed="true"[^>]*>All <span class="n">2<\/span>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Files <span class="n">2<\/span>/);
    expect(html).not.toContain(">Feeds <");
  });

  it("opens the addition it is asked to, and names nobody in a one-person vault", () => {
    const id = timeline.additions.find((a) => a.title === "Machine-Learning-Systems-Vol1")?.id;
    const html = render({ initialSelected: id });
    expect(html).toContain("Show in graph");
    expect(html).toContain("Added on Thursday, October 15 at 7:04 PM.");
    expect(html).not.toContain("did:key");
  });

  it("says 'by you' for the signed-in contributor once the vault has more than one", () => {
    const ME = "0x1234567890abcdef1234567890abcdef12345678";
    const OTHER = "0xfeedfacefeedfacefeedfacefeedfacefeedface";
    const shared = buildSourceTimeline({
      sourcesFolderId: "root",
      folders: [{ id: "root", name: "sources", parentFolder: null }, { id: "fa", name: "Mine", parentFolder: "root" }, { id: "fb", name: "Theirs", parentFolder: "root" }],
      sources: [source("sa", "fa", "2026-10-10T20:14:00.000Z", { addedBy: ME }), source("sb", "fb", "2026-10-15T19:04:00.000Z", { addedBy: OTHER })],
      nodes: notes.slice(0, 2),
      edges: [{ source: "n1", target: "sa", type: "DERIVED_FROM" }, { source: "n2", target: "sb", type: "DERIVED_FROM" }],
    });
    const mine = shared.additions.find((a) => a.title === "Mine")?.id;
    const theirs = shared.additions.find((a) => a.title === "Theirs")?.id;
    expect(render({ timeline: shared, me: ME.toUpperCase().replace("0X", "0x"), initialSelected: mine })).toContain("by you");
    const other = render({ timeline: shared, me: ME, initialSelected: theirs });
    expect(other).toContain("by 0xfeed…face");
    expect(other).not.toContain("by you");
  });

  it("offers Paste text beside Add sources, as the Folders tab does", () => {
    const html = render({ onPasteText: noop });
    expect(html).toMatch(/title="Create a source from text you paste"[^>]*>Paste text<\/button>/);
    expect(html.indexOf("Paste text")).toBeLessThan(html.indexOf("Add sources"));
    expect(render()).not.toContain(">Paste text<");
  });

  it("offers Paste text in the empty state too", () => {
    const html = render({ timeline: { additions: [], notes: [], topics: [], totals: { sources: 0, notes: 0, topics: 0, links: 0 } }, onPasteText: noop });
    expect(html.match(/>Paste text</g)).toHaveLength(2);
  });

  it("shows about a page of rows, and the rest behind Show earlier days", () => {
    const days = Array.from({ length: 70 }, (_, i) => source(`s${i}`, `f${i}`, new Date(Date.UTC(2026, 7, 1 + i, 9)).toISOString()));
    const long = buildSourceTimeline({
      sourcesFolderId: "root",
      folders: [{ id: "root", name: "sources", parentFolder: null }, ...days.map((d, i) => ({ id: `f${i}`, name: `Day ${i}`, parentFolder: "root" }))],
      sources: days,
      nodes: [],
      edges: [],
    });
    const html = render({ timeline: long });
    expect(html.match(/class="tl-row[ "]/g)).toHaveLength(60);
    expect(html).toContain("Show earlier days (10 more additions)");
  });

  it("offers to see an addition's notes when it has some", () => {
    const id = timeline.additions.find((a) => a.title === "Machine-Learning-Systems-Vol1")?.id;
    expect(render({ initialSelected: id, onSeeNotes: noop })).toContain("See its 2 notes");
    expect(render({ initialSelected: id })).not.toContain("See its");
  });

  it("says so when the browser built the timeline", () => {
    expect(render({ mode: "browser" })).toContain("Note times here are when notes were written");
    expect(render()).not.toContain("Note times here are when notes were written");
  });

  it("invites a first addition when there is none", () => {
    const html = render({ timeline: { additions: [], notes: [], topics: [], totals: { sources: 0, notes: 0, topics: 0, links: 0 } } });
    expect(html).toContain("Nothing added yet");
    expect(html).toContain("Add sources");
    expect(html).not.toContain('class="tl-strata"');
  });

  it("shows the loader while the first timeline loads, and the failure when it cannot", () => {
    expect(render({ timeline: null, isLoading: true })).toContain("Reading the vault");
    const failed = render({ timeline: null, isLoading: false, error: new Error("HTTP 502 from the knowledge graph") });
    expect(failed).toContain("The timeline could not be read");
    expect(failed).toContain("HTTP 502 from the knowledge graph");
  });
});
