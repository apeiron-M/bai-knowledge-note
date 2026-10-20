import { describe, expect, it } from "vitest";
import {
  summarizeLink,
  summarizeOperation,
} from "../../processors/graph-indexer/summarize.js";

describe("summarizeLink", () => {
  it("says what was linked, with the target's title and the link's kind", () => {
    expect(
      summarizeLink(
        "ADD_RELATIONSHIP",
        { sourceId: "a", targetId: "b", relationshipType: "BUILDS_ON" },
        "Caching claim",
      ),
    ).toBe("Linked to “Caching claim” (builds on)");
  });

  it("defaults the kind to relates to", () => {
    expect(
      summarizeLink("ADD_RELATIONSHIP", { sourceId: "a", targetId: "b" }, "B"),
    ).toBe("Linked to “B” (relates to)");
  });

  it("says a link was removed or re-explained", () => {
    expect(
      summarizeLink("REMOVE_RELATIONSHIP", { sourceId: "a", targetId: "b" }, "B"),
    ).toBe("Removed the link to “B”");
    expect(
      summarizeLink("UPDATE_RELATIONSHIP", { sourceId: "a", targetId: "b" }, "B"),
    ).toBe("Changed why it links to “B”");
  });

  it("falls back to the target id when the target has no title", () => {
    expect(
      summarizeLink("REMOVE_RELATIONSHIP", { sourceId: "a", targetId: "doc-9" }, null),
    ).toBe("Removed the link to “doc-9”");
  });

  it("is null for anything that is not a link operation", () => {
    expect(summarizeLink("SET_TITLE", { title: "x" }, null)).toBeNull();
  });
});

describe("summarizeOperation", () => {
  it("no longer knows SET_STATUS, which no model defines", () => {
    expect(summarizeOperation("SET_STATUS", { status: "CANONICAL" })).toBe("SET_STATUS");
  });
});
