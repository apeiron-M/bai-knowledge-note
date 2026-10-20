import { describe, expect, it } from "vitest";
import { matchNotes } from "./note-finder.js";

const doc = (id: string, title: string) => ({ id, title, documentType: "bai/knowledge-note", noteType: null });
const docs = [
  doc("a", "Direct expenses have become the dominant expense category for the protocol"),
  doc("b", "A headline fall in operating expenses can be an accounting reclassification"),
  doc("c", "Expenses fell in Q1"),
  doc("d", "Revenue grew in Q2"),
];

describe("matchNotes", () => {
  it("finds nothing for an empty query", () => {
    expect(matchNotes("   ", docs)).toEqual([]);
  });
  it("finds notes whose title holds every word, in any order and case, titles starting with the query first", () => {
    expect(matchNotes("expenses", docs).map((d) => d.id)).toEqual(["c", "a", "b"]);
    expect(matchNotes("OPERATING fall", docs).map((d) => d.id)).toEqual(["b"]);
  });
  it("takes a pasted id as that note", () => {
    expect(matchNotes("d", docs).map((d) => d.id)).toEqual(["d"]);
  });
  it("leaves out notes already chosen, including by id", () => {
    expect(matchNotes("expenses", docs, new Set(["c"])).map((d) => d.id)).toEqual(["a", "b"]);
    expect(matchNotes("d", docs, new Set(["d"]))).toEqual([]);
  });
  it("shows at most six", () => {
    const many = Array.from({ length: 10 }, (_, i) => doc(`m${i}`, `Note ${i}`));
    expect(matchNotes("note", many)).toHaveLength(6);
  });
});
