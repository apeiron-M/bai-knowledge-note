import { describe, expect, it } from "vitest";
import { orientationStats } from "./orientation.js";

describe("orientationStats", () => {
  it("reads the counts of a vault_stats answer", () => {
    expect(orientationStats({ nodeCount: 12, noteCount: 10, mocCount: 2, openTensionCount: 1, edgeCount: 30, density: 0.2 })).toEqual({
      nodeCount: 12,
      noteCount: 10,
      mocCount: 2,
      openTensionCount: 1,
      edgeCount: 30,
    });
  });

  it("is null for the answer of a server without the knowledge graph", () => {
    expect(orientationStats({ graphError: "HTTP 404 from the knowledge graph", sources: { total: 3, folderCount: 1 } })).toBeNull();
  });

  it("is null for anything that is not counts", () => {
    for (const data of [null, undefined, "12 notes", [], { nodeCount: "12", edgeCount: 3 }, { nodeCount: 12 }]) {
      expect(orientationStats(data)).toBeNull();
    }
  });
});
