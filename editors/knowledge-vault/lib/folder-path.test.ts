import { describe, expect, it } from "vitest";
import { ancestorFolderIds } from "./folder-path.js";

// sources/ → SkyEcosystem_SFF-Q1-Report/ → monthly-pl (the case that prompted this)
const NODES = [
  { id: "knowledge", parentFolder: null },
  { id: "sources", parentFolder: null },
  { id: "sky-report", parentFolder: "sources" },
  { id: "monthly-pl", parentFolder: "sky-report" },
  { id: "loose-source", parentFolder: "sources" },
  { id: "root-file" },
];

describe("ancestorFolderIds", () => {
  it("lists every folder above a nested document, outermost first", () => {
    expect(ancestorFolderIds(NODES, "monthly-pl")).toEqual([
      "sources",
      "sky-report",
    ]);
  });

  it("lists the one folder above a document one level down", () => {
    expect(ancestorFolderIds(NODES, "loose-source")).toEqual(["sources"]);
  });

  it("is empty for a top-level node, with a null or an absent parent", () => {
    expect(ancestorFolderIds(NODES, "knowledge")).toEqual([]);
    expect(ancestorFolderIds(NODES, "root-file")).toEqual([]);
  });

  it("is empty when nothing is selected", () => {
    expect(ancestorFolderIds(NODES, undefined)).toEqual([]);
    expect(ancestorFolderIds(NODES, null)).toEqual([]);
  });

  it("is empty for an id the tree has not caught up with yet", () => {
    expect(ancestorFolderIds(NODES, "not-in-tree")).toEqual([]);
    expect(ancestorFolderIds([], "monthly-pl")).toEqual([]);
  });

  it("stops at a parent chain that loops instead of spinning", () => {
    const loop = [
      { id: "a", parentFolder: "b" },
      { id: "b", parentFolder: "a" },
      { id: "doc", parentFolder: "a" },
    ];
    expect(ancestorFolderIds(loop, "doc")).toEqual(["b", "a"]);
  });

  it("does not list the selected node itself when it is part of a loop", () => {
    const selfLoop = [{ id: "folder", parentFolder: "folder" }];
    expect(ancestorFolderIds(selfLoop, "folder")).toEqual([]);
  });
});
