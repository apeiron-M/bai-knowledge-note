import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";
import { NoteList } from "./NoteList.js";

type Link = KnowledgeNoteInfo["links"][number];
const link = (to: string, type: string, reason: string | null = null): Link => ({ id: `${type}-${to}`, targetDocumentId: to, targetTitle: null, linkType: type, reason, confidence: null });
const note = (id: string, title: string, links: Link[] = [], status = "IN_REVIEW"): KnowledgeNoteInfo => ({ id, name: id, title, noteType: "CONCEPT", status, description: null, topics: [], links, provenance: null });
const notes = [note("a", "Grids make layouts predictable"), note("b", "Contrast directs attention"), note("c", "Pasted ideas need a home")];

describe("NoteList, narrowed to one addition's notes", () => {
  it("shows only those notes, says whose they are, and offers the way back", () => {
    const html = renderToStaticMarkup(<NoteList notes={notes} scope={{ label: "Design-Handbook", ids: new Set(["a", "b"]) }} onClearScope={() => {}} />);
    expect(html).toContain("Grids make layouts predictable");
    expect(html).toContain("Contrast directs attention");
    expect(html).not.toContain("Pasted ideas need a home");
    expect(html).toContain("Showing the <b>2 notes</b> from <b>Design-Handbook</b>");
    expect(html).toContain("Show all notes");
  });

  it("says so when none of them are in the list", () => {
    const html = renderToStaticMarkup(<NoteList notes={notes} scope={{ label: "Fresh-Upload", ids: new Set(["zz"]) }} onClearScope={() => {}} />);
    expect(html).toContain("No notes from <b>Fresh-Upload</b> are in the list yet");
    expect(html).toContain("Show all notes");
  });

  it("lists everything without a scope", () => {
    const html = renderToStaticMarkup(<NoteList notes={notes} />);
    expect(html).toContain("Pasted ideas need a home");
    expect(html).not.toContain("Show all notes");
  });
});

// A book in three chapters, one of which gave no notes; its notes in two topics.
const tree = [
  { id: "f-sources", name: "sources", kind: "folder", parentFolder: null },
  { id: "f-book", name: "The Money Book", kind: "folder", parentFolder: "f-sources" },
  { id: "ch-a", name: "The Money Book - Start Here", kind: "file", documentType: "bai/source", parentFolder: "f-book" },
  { id: "ch-b", name: "The Money Book - Upsells", kind: "file", documentType: "bai/source", parentFolder: "f-book" },
  { id: "ch-c", name: "The Money Book - Conclusion", kind: "file", documentType: "bai/source", parentFolder: "f-book" },
];
const longClaim = "The four offer types are distinguished by which revenue constraint each removes, not by where they sit in a funnel";
const book = [
  note("n1", longClaim, [link("ch-a", "DERIVED_FROM")], "CANONICAL"),
  note("n2", "An upsell follows the first yes", [link("ch-b", "DERIVED_FROM"), link("n1", "BUILDS_ON")], "CANONICAL"),
  note("n3", "Anchors set the discount", [link("ch-b", "DERIVED_FROM"), link("n1", "BUILDS_ON")]),
  note("n4", "A downsell changes what is bought", [link("ch-b", "DERIVED_FROM"), link("n2", "RELATES_TO")], "CANONICAL"),
  note("n5", "Continuity needs a front offer", [link("ch-a", "DERIVED_FROM")], "CANONICAL"),
];
const moc = (id: string, title: string, tier: MocInfo["tier"], ids: string[], childRefs: string[] = []): MocInfo => ({ id, title, tier, noteCount: ids.length, coreIdeas: ids.map((noteRef) => ({ noteRef, contextPhrase: "" })), childRefs });
const mocs = [moc("hub", "Overview", "HUB", [], ["area"]), moc("area", "Money", "DOMAIN", ["n1", "n2", "n3", "n4", "n5"], ["up", "basics"]), moc("up", "Upsells", "TOPIC", ["n2", "n3", "n4"]), moc("basics", "Basics", "TOPIC", ["n1", "n5"])];

describe("NoteList, by where the notes came from", () => {
  const html = renderToStaticMarkup(<NoteList notes={book} mocs={mocs} tree={tree} />);

  it("says what a note is, and how many came from how many sources", () => {
    expect(html).toContain("Each note is one idea the vault took from a source you added");
    expect(html).toContain("These 5 came from 1 source and sit in 3 topics.");
  });

  it("explains how notes work on a first visit, with the vault's own largest source", () => {
    expect(html).toContain("How notes work");
    expect(html).toContain("You add a source");
    expect(html).toContain(`<q>${longClaim}</q>`);
    expect(html).toContain("2 notes link to that one");
  });

  it("puts the source in the margin with the topics it fed, and its key ideas beside it, whole", () => {
    expect(html).toContain("The Money Book</h2>");
    expect(html).toContain("Topics it fed");
    expect(html).toContain("Key ideas");
    expect(html).toContain(longClaim);
    expect(html).toContain("1 part gave no notes: Conclusion.");
    expect(html).toContain("Start Here");
    expect(html).toContain("1 note to review.");
  });

  it("speaks the reader's words, not the engine's", () => {
    expect(html).not.toContain("CANONICAL");
    expect(html).not.toContain("IN_REVIEW");
    expect(html).toContain(">Concept<");
  });

  it("narrowed to part of a source, lists the matching notes under their parts, with their state", () => {
    const narrowed = renderToStaticMarkup(<NoteList notes={book} mocs={mocs} tree={tree} scope={{ label: "One note", ids: new Set(["n3"]) }} />);
    expect(narrowed).toContain("Anchors set the discount");
    expect(narrowed).toContain("Waiting for review");
    expect(narrowed).toMatch(/vn-subhd">Upsells/);
    expect(narrowed).not.toContain(`class="vn-claim">${longClaim}`);
    expect(narrowed.match(/data-tour="note-card"/g)).toHaveLength(1);
  });

  it("marks the first note for the Try on web tour, and only it", () => {
    expect(html.match(/data-tour="note-card"/g)).toHaveLength(1);
  });
});

describe("NoteList, narrowed to part of a long source", () => {
  it("draws the twelve most connected matches and offers the rest", () => {
    const many = Array.from({ length: 20 }, (_, i) => note(`m${i}`, `Idea number ${i}`, [link("ch-b", "DERIVED_FROM")], "CANONICAL"));
    const ids = new Set(many.slice(0, 15).map((n) => n.id));
    const html = renderToStaticMarkup(<NoteList notes={many} tree={tree} scope={{ label: "Fifteen", ids }} />);
    expect(html.match(/class="vn-row"/g)).toHaveLength(12);
    expect(html).toContain("Show all 15 notes");
  });
});

describe("NoteList with nothing in it", () => {
  it("teaches the four steps and offers to add a source", () => {
    const html = renderToStaticMarkup(<NoteList notes={[]} onAddSources={() => {}} onPasteText={() => {}} />);
    expect(html).toContain("No notes yet");
    expect(html).toContain("Add sources");
    expect(html).toContain("How notes work");
  });

  it("says the sources are being read while they are", () => {
    const html = renderToStaticMarkup(<NoteList notes={[]} sourcesBusy onSeeSources={() => {}} />);
    expect(html).toContain("Your sources are being read");
    expect(html).toContain("See progress in Sources");
  });

  it("waits for the first read instead of claiming the vault is empty", () => {
    const html = renderToStaticMarkup(<NoteList notes={[]} isLoading />);
    expect(html).toContain("Loading notes");
    expect(html).not.toContain("No notes yet");
  });
});
