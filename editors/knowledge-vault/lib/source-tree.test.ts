import { describe, expect, it } from "vitest";
import { sourceView, type TreeNode } from "./source-tree.js";
import type { SourceRow } from "./source-search.js";

const row = (id: string, title = id): SourceRow => ({
  id,
  name: title,
  title,
  description: null,
  author: null,
  url: null,
  sourceType: null,
  status: "INBOX",
  claimCount: 0,
  createdBy: null,
});

const NODES: TreeNode[] = [
  { id: "f-sources", name: "sources", kind: "folder", parentFolder: null },
  { id: "f-knowledge", name: "knowledge", kind: "folder", parentFolder: null },
  { id: "f-book", name: "A Book", kind: "folder", parentFolder: "f-sources" },
  { id: "f-part", name: "Part II", kind: "folder", parentFolder: "f-book" },
  // loose source at the /sources root
  { id: "s-loose", name: "loose", kind: "file", documentType: "bai/source", parentFolder: "f-sources" },
  // chapters
  { id: "s-ch1", name: "ch1", kind: "file", documentType: "bai/source", parentFolder: "f-book" },
  { id: "s-ch2", name: "ch2", kind: "file", documentType: "bai/source", parentFolder: "f-book" },
  { id: "s-deep", name: "deep", kind: "file", documentType: "bai/source", parentFolder: "f-part" },
];

const ROWS = [row("s-loose"), row("s-ch1"), row("s-ch2"), row("s-deep")];

describe("sourceView", () => {
  it("at the root, shows folders and only the sources directly in /sources", () => {
    const v = sourceView(ROWS, NODES, null);
    expect(v.folders.map((f) => f.id)).toEqual(["f-book"]);
    expect(v.sources.map((s) => s.id)).toEqual(["s-loose"]);
  });

  it("counts every source beneath a folder, not just its direct children", () => {
    // "A Book (3)" — two chapters plus one in Part II. A count that stopped
    // at the first level would under-report a book with parts.
    const v = sourceView(ROWS, NODES, null);
    expect(v.folders[0].count).toBe(3);
  });

  it("inside a folder, shows its subfolders and its own sources", () => {
    const v = sourceView(ROWS, NODES, "f-book");
    expect(v.folders.map((f) => f.id)).toEqual(["f-part"]);
    expect(v.sources.map((s) => s.id)).toEqual(["s-ch1", "s-ch2"]);
  });

  it("gives a breadcrumb back to the root", () => {
    expect(sourceView(ROWS, NODES, "f-part").breadcrumb).toEqual([
      { id: null, name: "Sources" },
      { id: "f-book", name: "A Book" },
      { id: "f-part", name: "Part II" },
    ]);
    expect(sourceView(ROWS, NODES, null).breadcrumb).toEqual([
      { id: null, name: "Sources" },
    ]);
  });

  it("never shows a folder from another part of the vault", () => {
    // /knowledge is a sibling of /sources, not a source folder.
    const v = sourceView(ROWS, NODES, null);
    expect(v.folders.map((f) => f.id)).not.toContain("f-knowledge");
  });

  it("flattens when a search is running, because a match hidden in a folder looks broken", () => {
    const v = sourceView(ROWS, NODES, "f-book", { flatten: true });
    expect(v.folders).toEqual([]);
    expect(v.sources.map((s) => s.id).sort()).toEqual(["s-ch1", "s-ch2", "s-deep", "s-loose"]);
  });

  it("falls back to the flat list when the drive has no /sources folder", () => {
    const v = sourceView(ROWS, [], null);
    expect(v.folders).toEqual([]);
    expect(v.sources).toHaveLength(4);
  });

  it("returns to the root when the open folder has vanished", () => {
    // Deleted underneath the user: show the root rather than an empty view
    // with a breadcrumb pointing at nothing.
    const v = sourceView(ROWS, NODES, "gone");
    expect(v.breadcrumb).toEqual([{ id: null, name: "Sources" }]);
    expect(v.sources.map((s) => s.id)).toEqual(["s-loose"]);
  });

  it("keeps a source whose node the tree does not carry", () => {
    // The row list and the tree are fetched separately; a source present in
    // one and not yet the other must not disappear from the root.
    const v = sourceView([...ROWS, row("s-unknown")], NODES, null);
    expect(v.sources.map((s) => s.id)).toContain("s-unknown");
  });
});
