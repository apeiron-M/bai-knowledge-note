/**
 * What the note editor sends for a link: one ADD_RELATIONSHIP with its reason,
 * or — for a new target — the REMOVE and the ADD in one batch. Nothing at all
 * without a target, or with the note itself as the target.
 */
import { describe, expect, it } from "vitest";
import { addLinkActions, retargetLinkActions } from "./link-actions.js";

const NOW = "2026-10-16T09:00:00.000Z";
const clock = () => {
  let n = 0;
  return { now: NOW, newId: () => `a${++n}` };
};
const WHY = { reason: "It names the chip the paper measures", confidence: "grounded" as const };
const META = { reason: WHY.reason, confidence: "grounded" };

describe("adding a link", () => {
  it("sends one ADD_RELATIONSHIP, with the reason as its metadata", () => {
    expect(addLinkActions("note-1", "src-3", "DERIVED_FROM", WHY, clock())).toEqual([
      {
        id: "a1",
        type: "ADD_RELATIONSHIP",
        scope: "document",
        timestampUtcMs: NOW,
        input: { sourceId: "note-1", targetId: "src-3", relationshipType: "DERIVED_FROM", metadata: META },
      },
    ]);
  });

  it("sends nothing without a target, or to the note itself", () => {
    expect(addLinkActions("note-1", "", "RELATES_TO", WHY, clock())).toEqual([]);
    expect(addLinkActions("note-1", "   ", "RELATES_TO", WHY, clock())).toEqual([]);
    expect(addLinkActions("note-1", "note-1", "RELATES_TO", WHY, clock())).toEqual([]);
  });
});

describe("changing a link's target", () => {
  const link = { targetDocumentId: "note-2", linkType: "BUILDS_ON" };

  it("removes the old pair and adds the new one, with the reason, in one batch", () => {
    expect(retargetLinkActions("note-1", link, "note-3", WHY, clock())).toEqual([
      {
        id: "a1",
        type: "REMOVE_RELATIONSHIP",
        scope: "document",
        timestampUtcMs: NOW,
        input: { sourceId: "note-1", targetId: "note-2", relationshipType: "BUILDS_ON" },
      },
      {
        id: "a2",
        type: "ADD_RELATIONSHIP",
        scope: "document",
        timestampUtcMs: NOW,
        input: { sourceId: "note-1", targetId: "note-3", relationshipType: "BUILDS_ON", metadata: META },
      },
    ]);
  });

  it("reads a link with no kind as Relates to", () => {
    const acts = retargetLinkActions("note-1", { targetDocumentId: "note-2", linkType: null }, "note-3", WHY, clock());
    expect(acts.map((a) => a.input.relationshipType)).toEqual(["RELATES_TO", "RELATES_TO"]);
  });

  it("changes nothing when the new target is missing, the note itself, or the same one — or the link has none", () => {
    expect(retargetLinkActions("note-1", link, "", WHY, clock())).toEqual([]);
    expect(retargetLinkActions("note-1", link, "note-1", WHY, clock())).toEqual([]);
    expect(retargetLinkActions("note-1", link, "note-2", WHY, clock())).toEqual([]);
    expect(retargetLinkActions("note-1", { targetDocumentId: null, linkType: "BUILDS_ON" }, "note-3", WHY, clock())).toEqual([]);
  });
});
