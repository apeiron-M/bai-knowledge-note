/**
 * Where a link may point: a document of this vault, chosen from a list —
 * sources for "Derived from", notes otherwise — or a pasted id that names any
 * document in the drive. Never the note itself.
 */
import { describe, expect, it } from "vitest";
import type { VaultDocSummary } from "../../shared/vault-doc-index-store.js";
import {
  candidateLabel,
  documentKind,
  linkCandidates,
  linkedTargets,
  pastedIdMatch,
  searchCandidates,
  type LinkCandidate,
} from "./link-targets.js";

const NOTE = "bai/knowledge-note";
const doc = (id: string, title: string, documentType: string): VaultDocSummary => ({ id, title, documentType, noteType: null });
const docs = [
  doc("note-1", "This note", NOTE),
  doc("note-2", "Chips are scarce", NOTE),
  doc("moc-1", "Hardware map", "bai/moc"),
  doc("src-3", "Chapter 3 Hardware", "bai/source"),
  doc("src-4", "Chapter 4 Memory", "bai/source"),
];
const byId = new Map(docs.map((d) => [d.id, d] as const));
const knowledgeDocs = docs.filter((d) => d.documentType === NOTE || d.documentType === "bai/moc");
const none: ReadonlySet<string> = new Set();
const base = { noteId: "note-1", knowledgeDocs, byId, exclude: none };

describe("where a link may point", () => {
  it("offers notes for every kind but Derived from — never the note itself", () => {
    expect(linkCandidates({ ...base, linkType: "RELATES_TO" }).map((c) => c.id)).toEqual(["note-2"]);
    expect(linkCandidates({ ...base, linkType: "BUILDS_ON" }).map((c) => c.id)).toEqual(["note-2"]);
  });

  it("offers the vault's sources for Derived from", () => {
    expect(linkCandidates({ ...base, linkType: "DERIVED_FROM" })).toEqual([
      { id: "src-3", title: "Chapter 3 Hardware", kind: "source" },
      { id: "src-4", title: "Chapter 4 Memory", kind: "source" },
    ]);
  });

  it("leaves out what is excluded", () => {
    expect(linkCandidates({ ...base, linkType: "DERIVED_FROM", exclude: new Set(["src-3"]) }).map((c) => c.id)).toEqual(["src-4"]);
  });
});

describe("a pasted id", () => {
  it("matches any document in this drive, named with its kind", () => {
    const m = pastedIdMatch("  src-3 ", { noteId: "note-1", byId, exclude: none });
    expect(m && candidateLabel(m)).toBe("Chapter 3 Hardware · source");
    expect(pastedIdMatch("moc-1", { noteId: "note-1", byId, exclude: none })).toEqual({ id: "moc-1", title: "Hardware map", kind: "map" });
  });

  it("matches nothing for an id outside the drive, the note itself, an excluded one, or nothing typed", () => {
    expect(pastedIdMatch("phd-elsewhere", { noteId: "note-1", byId, exclude: none })).toBeNull();
    expect(pastedIdMatch("note-1", { noteId: "note-1", byId, exclude: none })).toBeNull();
    expect(pastedIdMatch("src-3", { noteId: "note-1", byId, exclude: new Set(["src-3"]) })).toBeNull();
    expect(pastedIdMatch("   ", { noteId: "note-1", byId, exclude: none })).toBeNull();
  });
});

describe("the search list", () => {
  const sources = linkCandidates({ ...base, linkType: "DERIVED_FROM" });

  it("puts the pasted match first, once — even a document of another kind", () => {
    const src = pastedIdMatch("src-4", { noteId: "note-1", byId, exclude: none });
    expect(searchCandidates("src-4", sources, src).map((c) => c.id)).toEqual(["src-4"]);
    const moc = pastedIdMatch("moc-1", { noteId: "note-1", byId, exclude: none });
    expect(searchCandidates("moc-1", sources, moc).map((c) => c.id)).toEqual(["moc-1"]);
  });

  it("matches the title or the id, case aside, and shows the first 20 with nothing typed", () => {
    expect(searchCandidates("MEMORY", sources, null).map((c) => c.id)).toEqual(["src-4"]);
    const many: LinkCandidate[] = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, title: `S ${i}`, kind: "source" }));
    expect(searchCandidates("", many, null)).toHaveLength(20);
  });
});

describe("what a note already links to", () => {
  const links = [
    { targetDocumentId: "note-2", linkType: "BUILDS_ON" },
    { targetDocumentId: "src-3", linkType: "DERIVED_FROM" },
    { targetDocumentId: null, linkType: null },
    { targetDocumentId: "note-5", linkType: null },
  ];

  it("gives every target, or those of one kind — a link with no kind relates to", () => {
    expect([...linkedTargets(links)]).toEqual(["note-2", "src-3", "note-5"]);
    expect([...linkedTargets(links, "BUILDS_ON")]).toEqual(["note-2"]);
    expect([...linkedTargets(links, "RELATES_TO")]).toEqual(["note-5"]);
  });
});

describe("a document's kind, in words", () => {
  it("names the vault's kinds plainly", () => {
    expect(documentKind("bai/knowledge-note")).toBe("note");
    expect(documentKind("bai/source")).toBe("source");
    expect(documentKind("bai/moc")).toBe("map");
    expect(documentKind("bai/wbs")).toBe("work breakdown");
    expect(documentKind("powerhouse/scopeofwork")).toBe("scope of work");
    expect(documentKind("bai/research-claim")).toBe("research claim");
  });
});
