import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import { NoteList } from "./NoteList.js";

const note = (id: string, title: string): KnowledgeNoteInfo => ({ id, name: id, title, noteType: "concept", status: "IN_REVIEW", description: null, topics: [], links: [], provenance: null });
const notes = [note("a", "Grids make layouts predictable"), note("b", "Contrast directs attention"), note("c", "Pasted ideas need a home")];

describe("NoteList, narrowed to one addition's notes", () => {
  it("shows only those notes, says whose they are, and offers the way back", () => {
    const html = renderToStaticMarkup(<NoteList notes={notes} scope={{ label: "Design-Handbook", ids: new Set(["a", "b"]) }} onClearScope={() => {}} />);
    expect(html).toContain("Grids make layouts predictable");
    expect(html).toContain("Contrast directs attention");
    expect(html).not.toContain("Pasted ideas need a home");
    expect(html).toContain("2 notes from <b>Design-Handbook</b>");
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
