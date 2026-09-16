import { beforeEach, describe, expect, it } from "vitest";
import {
  describeStatuses,
  folderContents,
  readOpenFolder,
  sourceView,
  writeOpenFolder,
  type TreeNode,
} from "./source-tree.js";
import type { SourceRow } from "./source-search.js";

const row = (id: string, status = "INBOX", title = id): SourceRow => ({
  id,
  name: title,
  title,
  description: null,
  author: null,
  url: null,
  sourceType: null,
  status,
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

describe("sourceView status tally", () => {
  it("counts each status beneath a folder, so a mixed book says so", () => {
    // The whole reason a folder cannot sit inside one status group: it is
    // not in one status.
    const rows = [
      row("s-ch1", "EXTRACTED"),
      row("s-ch2", "EXTRACTED"),
      row("s-deep", "INBOX"),
      row("s-loose", "INBOX"),
    ];
    const v = sourceView(rows, NODES, null);
    expect(v.folders[0].byStatus).toEqual({ EXTRACTED: 2, INBOX: 1 });
  });

  it("reports a single status when every source beneath shares one", () => {
    const rows = [
      row("s-ch1", "EXTRACTED"),
      row("s-ch2", "EXTRACTED"),
      row("s-deep", "EXTRACTED"),
      row("s-loose", "INBOX"),
    ];
    expect(sourceView(rows, NODES, null).folders[0].byStatus).toEqual({
      EXTRACTED: 3,
    });
  });

  it("totals every source at or beneath the current folder", () => {
    // What the header counts: the whole vault at the root, the book inside it.
    const rows = [row("s-loose"), row("s-ch1"), row("s-ch2"), row("s-deep")];
    expect(sourceView(rows, NODES, null).total).toBe(4);
    expect(sourceView(rows, NODES, "f-book").total).toBe(3);
    expect(sourceView(rows, NODES, "f-part").total).toBe(1);
  });

  it("counts what a search matched when flattened", () => {
    const rows = [row("s-ch1"), row("s-ch2")];
    expect(sourceView(rows, NODES, "f-book", { flatten: true }).total).toBe(2);
  });
});

describe("describeStatuses", () => {
  it("collapses to one phrase when every source agrees", () => {
    expect(describeStatuses({ EXTRACTED: 3 })).toBe("3 extracted");
  });

  it("lists a mixed folder in pipeline order, not by count", () => {
    // Stable ordering matters: the same folder must read the same way
    // between renders, and INBOX first is what a reader scans for.
    expect(describeStatuses({ EXTRACTED: 2, INBOX: 1 })).toBe(
      "1 inbox · 2 extracted",
    );
  });

  it("puts an unrecognised status last rather than dropping it", () => {
    expect(describeStatuses({ INBOX: 1, WEIRD: 2 })).toBe("1 inbox · 2 weird");
  });

  it("is empty for an empty folder", () => {
    expect(describeStatuses({})).toBe("");
  });
});

describe("remembering the open folder", () => {
  beforeEach(() => sessionStorage.clear());

  it("round-trips the folder you were in", () => {
    writeOpenFolder("f-book");
    expect(readOpenFolder()).toBe("f-book");
  });

  it("clears back to the root", () => {
    writeOpenFolder("f-book");
    writeOpenFolder(null);
    expect(readOpenFolder()).toBeNull();
  });

  it("reads null when nothing was stored", () => {
    expect(readOpenFolder()).toBeNull();
  });

  it("survives storage being unavailable", () => {
    // Private mode: losing your place must not take the list down with it.
    const original = globalThis.sessionStorage;
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });
    expect(() => writeOpenFolder("f-book")).not.toThrow();
    expect(readOpenFolder()).toBeNull();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: original,
    });
  });
});

describe("folderContents", () => {
  it("collects every source and subfolder beneath, deepest folder last", () => {
    // Deleting a book must take its chapters with it, including any in
    // parts — otherwise the documents survive with no folder pointing at
    // them, which is how the vault accumulated nine stranded sources.
    const c = folderContents(NODES, "f-book");
    expect(c.sourceIds.sort()).toEqual(["s-ch1", "s-ch2", "s-deep"]);
    expect(c.folderIds).toContain("f-book");
    expect(c.folderIds).toContain("f-part");
  });

  it("does not reach outside the folder", () => {
    const c = folderContents(NODES, "f-part");
    expect(c.sourceIds).toEqual(["s-deep"]);
    expect(c.folderIds).toEqual(["f-part"]);
  });

  it("returns nothing for a folder the tree does not hold", () => {
    expect(folderContents(NODES, "gone")).toEqual({
      folderIds: [],
      sourceIds: [],
    });
  });

  it("ignores files that are not sources", () => {
    const withNote = [
      ...NODES,
      { id: "n-1", name: "a note", kind: "file" as const, documentType: "bai/knowledge-note", parentFolder: "f-book" },
    ];
    expect(folderContents(withNote, "f-book").sourceIds).not.toContain("n-1");
  });
});
