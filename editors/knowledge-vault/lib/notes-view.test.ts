import { describe, expect, it } from "vitest";
import type { SourceTimeline, TimelineAddition } from "../../../processors/graph-indexer/source-timeline.js";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";
import {
  UNSOURCED,
  buildNotesIndex,
  crossSourceLinks,
  degree,
  keyIdeas,
  needsReview,
  noteMatches,
  partTitle,
  passageText,
  searchWords,
  sourceLabel,
  sourcesOf,
  topicsFed,
} from "./notes-view.js";

type Link = KnowledgeNoteInfo["links"][number];
const link = (to: string, type: string, reason: string | null = null): Link => ({ id: `${type}-${to}`, targetDocumentId: to, targetTitle: null, linkType: type, reason, confidence: null });
const note = (id: string, title: string, links: Link[] = [], extra: Partial<KnowledgeNoteInfo> = {}): KnowledgeNoteInfo => ({
  id, name: id, title, noteType: "CONCEPT", status: "CANONICAL", description: null, topics: [], links, provenance: null, ...extra,
});
const moc = (id: string, title: string, tier: MocInfo["tier"], notes: string[] = [], childRefs: string[] = []): MocInfo => ({
  id, title, tier, noteCount: notes.length, coreIdeas: notes.map((noteRef) => ({ noteRef, contextPhrase: "" })), childRefs,
});
const addition = (a: Partial<TimelineAddition>): TimelineAddition => ({
  id: "add", kind: "file", title: "", folderId: null, addedAt: "2026-09-01T10:00:00Z", lastAddedAt: "2026-09-01T10:00:00Z", addedBy: null, fileName: null,
  mimeType: null, sizeBytes: null, method: null, tool: null, url: null, sourceType: null, sources: 0, extracted: 0, waiting: 0, archived: 0, sourceIds: [],
  notes: 0, firstNoteAt: null, lastNoteAt: null, writtenFrom: null, topicIds: [], linksWithin: 0, linksToEarlier: 0, earlier: [], tags: [], topNotes: [], firstSources: [], ...a,
});

// The drive: /sources holds a book in three chapters (one gave no notes) and a pasted text.
const tree = [
  { id: "f-sources", name: "sources", kind: "folder", parentFolder: null },
  { id: "f-book", name: "The Money Book", kind: "folder", parentFolder: "f-sources" },
  { id: "ch-b", name: "The Money Book - Upsells", kind: "file", documentType: "bai/source", parentFolder: "f-book" },
  { id: "ch-a", name: "The Money Book - Start Here", kind: "file", documentType: "bai/source", parentFolder: "f-book" },
  { id: "ch-c", name: "The Money Book - Conclusion", kind: "file", documentType: "bai/source", parentFolder: "f-book" },
  { id: "paste", name: "Meeting notes", kind: "file", documentType: "bai/source", parentFolder: "f-sources" },
];
const notes = [
  note("n1", "Offers relieve constraints", [link("ch-a", "DERIVED_FROM", 'Extracted from "Start Here": Start Here, paragraph 2')]),
  note("n2", "An upsell follows the first yes", [link("ch-b", "DERIVED_FROM"), link("n1", "BUILDS_ON", "applies n1 to the second purchase")]),
  note("n3", "Anchors set the discount", [link("ch-b", "DERIVED_FROM"), link("n1", "BUILDS_ON"), link("n2", "RELATES_TO")], { status: "IN_REVIEW" }),
  note("m1", "Decisions need an owner", [link("paste", "DERIVED_FROM"), link("n1", "RELATES_TO")], { status: "DRAFT" }),
  note("x1", "A note with nowhere to come from", [], { provenance: { author: "me", createdAt: "2026-10-01T00:00:00Z", updatedAt: null } }),
];
const mocs = [
  moc("hub", "My Vault", "HUB", [], ["area", "solo"]),
  moc("area", "Money", "DOMAIN", ["n1", "n2", "n3"], ["t-up", "t-start", "t-empty"]),
  moc("t-up", "Upsells", "TOPIC", ["n2", "n3"]),
  moc("t-start", "Basics", "TOPIC", ["n1"]),
  moc("t-empty", "Pricing", "TOPIC"),
  moc("solo", "Meetings", "TOPIC", ["m1"]),
];
const timeline: SourceTimeline = {
  additions: [
    addition({ id: "add-book", sourceType: "BOOK_CHAPTER", addedAt: "2026-09-16T20:00:00Z", lastAddedAt: "2026-09-16T20:06:00Z", sourceIds: ["ch-a", "ch-b", "ch-c"] }),
    addition({ id: "add-paste", kind: "text", addedAt: "2026-09-28T10:00:00Z", lastAddedAt: "2026-09-28T10:00:00Z", sourceIds: ["paste"] }),
    addition({ id: "add-loose", kind: "unsourced", sourceIds: [] }),
  ],
  notes: [], topics: [], totals: { sources: 4, notes: 5, topics: 5, links: 4 },
};

describe("buildNotesIndex: notes by where they came from", () => {
  const index = buildNotesIndex({ notes, mocs, tree, timeline });

  it("groups notes by the original they came from, newest first, the unsourced last", () => {
    expect(index.sources.map((s) => s.name)).toEqual(["Meeting notes", "The Money Book", "Notes with no source"]);
    const book = index.sources[1];
    expect(book).toMatchObject({ kind: "folder", label: "Book", partWord: "chapter", additionId: "add-book", partCount: 3 });
    expect(index.sources[2].id).toBe(UNSOURCED);
    expect(index.sourceOf.get("n2")).toBe(book);
  });

  it("keeps the document's order, names its parts as a reader would, and names the parts that gave nothing", () => {
    const book = index.sources[1];
    expect(book.parts.map((p) => p.title)).toEqual(["Start Here", "Upsells"]);
    expect(book.emptyParts.map((p) => p.title)).toEqual(["Conclusion"]);
    expect(book.noteIds).toEqual(["n1", "n2", "n3"]);
    expect(index.partOf.get("n3")?.title).toBe("Upsells");
    expect(index.sources[0].parts[0].title).toBe("Meeting notes");
  });

  it("knows where in its part each claim was found", () => {
    expect(index.passageOf.get("n1")).toBe("Start Here, paragraph 2");
    expect(index.passageOf.has("n2")).toBe(false);
  });

  it("counts links between notes, both ways, and ranks the most connected first", () => {
    expect(degree(index, "n1")).toBe(3);
    expect(degree(index, "n2")).toBe(2);
    expect(degree(index, "x1")).toBe(0);
    expect(index.links.get("n1")?.filter((l) => l.dir === "in").map((l) => l.other).sort()).toEqual(["m1", "n2", "n3"]);
    expect(keyIdeas(index, ["n2", "n3", "n1"], 2)).toEqual(["n1", "n2"]);
  });

  it("follows the overview: topic areas first, their topics largest first, empty ones named, loose notes last", () => {
    expect(index.topics.map((t) => t.moc?.title ?? null)).toEqual(["Money", "Meetings", null]);
    const money = index.topics[0];
    expect(money.subtopics.map((t) => t.moc.title)).toEqual(["Upsells", "Basics"]);
    expect(money.emptySubtopics.map((m) => m.title)).toEqual(["Pricing"]);
    expect(money.noteIds.sort()).toEqual(["n1", "n2", "n3"]);
    expect(index.topics[2].noteIds).toEqual(["x1"]);
    expect(index.topicCount).toBe(5);
    expect(index.topicOf.get("n2")?.title).toBe("Upsells");
  });

  it("says what a source fed and what it connects to", () => {
    const book = index.sources[1];
    expect(topicsFed(index, book.noteIds).map((t) => [t.moc.title, t.count])).toEqual([["Upsells", 2], ["Basics", 1]]);
    expect(crossSourceLinks(index, book).map((c) => [c.source.name, c.count])).toEqual([["Meeting notes", 1]]);
    expect(sourcesOf(index, ["n1", "n2", "m1"]).map((s) => [s.source.name, s.count])).toEqual([["The Money Book", 2], ["Meeting notes", 1]]);
  });

  it("searches the claim, the description, the topic and the source", () => {
    const n3 = index.byId.get("n3")!;
    expect(noteMatches(index, n3, searchWords("anchors"))).toBe(true);
    expect(noteMatches(index, n3, searchWords("UPSELLS money book"))).toBe(true);
    expect(noteMatches(index, n3, searchWords("meeting"))).toBe(false);
    expect(noteMatches(index, n3, [])).toBe(true);
  });

  it("works without a timeline: newest notes first, parts by name", () => {
    const dated = notes.map((n) => (n.id === "n2" ? { ...n, provenance: { author: null, createdAt: "2026-10-02T00:00:00Z", updatedAt: null } } : n));
    const bare = buildNotesIndex({ notes: dated, mocs, tree, timeline: null });
    expect(bare.sources[0].name).toBe("The Money Book");
    expect(bare.sources[0].parts.map((p) => p.title)).toEqual(["Start Here", "Upsells"]);
    expect(bare.sources[0]).toMatchObject({ label: null, partWord: "part", addedAt: null, additionId: null });
  });

  it("puts notes from a newer source above, whatever order the drive lists them in", () => {
    const withoutBook = buildNotesIndex({ notes: notes.slice(3), mocs: [], tree, timeline });
    expect(withoutBook.sources.map((s) => s.name)).toEqual(["Meeting notes", "Notes with no source"]);
    expect(withoutBook.topics.map((t) => t.moc)).toEqual([null]);
  });
});

describe("the words the page uses", () => {
  it("tidies part names", () => {
    expect(partTitle("$100M Money Models: How To Make Money - Anchor Upsell", "$100M Money Models")).toBe("Anchor Upsell");
    expect(partTitle("bai-knowledge-note — Ch. 2: The model — types", "bai-knowledge-note — how the vault works")).toBe("Ch. 2: The model — types");
    expect(partTitle("03-ch01-the-six-minds-of-experience", "Design for How People Think")).toBe("Ch. 01: The six minds of experience");
    expect(partTitle("02-part-i-rethinking-the-experience", "Design")).toBe("Part I: Rethinking the experience");
    expect(partTitle("00-book-record", "Design")).toBe("Book record");
    expect(partTitle("report.pdf.coredownload.inline.pdf · part 9", "Report")).toBe("Part 9");
    expect(partTitle("TRADING PAIRS VS. VOLUME", "Crypto report")).toBe("Trading pairs vs. volume");
    expect(partTitle("Overview", "The State of Crypto - 2026")).toBe("Overview");
  });

  it("names a source's kind and its parts", () => {
    expect(sourceLabel(undefined)).toEqual({ label: null, partWord: "part" });
    expect(sourceLabel(addition({ sourceType: "BOOK_CHAPTER", mimeType: "application/pdf" }))).toEqual({ label: "Book", partWord: "chapter" });
    expect(sourceLabel(addition({ mimeType: "application/pdf", fileName: "report.pdf" })).label).toBe("PDF");
    expect(sourceLabel(addition({ mimeType: "message/rfc822" }))).toEqual({ label: "Email", partWord: "message" });
    expect(sourceLabel(addition({ sourceType: "DOCUMENTATION" })).label).toBe("Documentation");
    expect(sourceLabel(addition({ kind: "text" })).label).toBe("Text");
    expect(sourceLabel(addition({ kind: "feed", tool: "granola" }))).toEqual({ label: "Meeting notes", partWord: "item" });
  });

  it("reads a passage out of a DERIVED_FROM reason", () => {
    expect(passageText('Extracted from "Overview": Overview, paragraph 1')).toBe("Overview, paragraph 1");
    expect(passageText("The PayPal Language analysis: buttons from interviews")).toBe("The PayPal Language analysis: buttons from interviews");
    expect(passageText("  ")).toBeNull();
    expect(passageText(null)).toBeNull();
  });

  it("treats drafts and notes in review as to review", () => {
    expect(needsReview({ status: "IN_REVIEW" })).toBe(true);
    expect(needsReview({ status: "DRAFT" })).toBe(true);
    expect(needsReview({ status: "CANONICAL" })).toBe(false);
  });
});
