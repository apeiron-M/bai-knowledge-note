import { describe, expect, it } from "vitest";
import { supersededBy, supersessionIndex } from "./supersession.js";

const notes = [
  { id: "new", title: "Group tables were dropped", links: [{ targetDocumentId: "old", linkType: "SUPERSEDES", reason: "migration 003 removed them" }, { targetDocumentId: "x", linkType: "RELATES_TO", reason: null }] },
  { id: "newer", title: null, name: "newer-note", links: [{ targetDocumentId: "old", linkType: "SUPERSEDES" }] },
  { id: "old", title: "Six tables", links: [{ targetDocumentId: "x", linkType: "BUILDS_ON", reason: null }] },
  { id: "x", title: "Unrelated", links: [] },
];

describe("supersession", () => {
  it("finds every note that supersedes a target, with the edge's reason", () => {
    expect(supersededBy(notes, "old")).toEqual([
      { documentId: "new", title: "Group tables were dropped", reason: "migration 003 removed them" },
      { documentId: "newer", title: "newer-note", reason: null },
    ]);
  });

  it("returns nothing for a current note, and ignores other link types", () => {
    expect(supersededBy(notes, "x")).toEqual([]);
    expect(supersededBy(notes, "new")).toEqual([]);
  });

  it("builds one index for many lookups", () => {
    const idx = supersessionIndex(notes);
    expect([...idx.keys()]).toEqual(["old"]);
    expect(idx.get("old")?.length).toBe(2);
  });
});
