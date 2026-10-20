import {
  addDeliverable,
  addMilestone,
  addMilestoneDeliverable,
  addRoadmap,
  editRoadmap,
  removeRoadmap,
  utils,
} from "document-models/scope-of-work/v1";
import { describe, expect, it } from "vitest";
import {
  apply,
  craft,
  errorAt,
  errors,
  rawMilestone,
  rawRoadmap,
  state,
} from "./reducer-test-helpers.js";

describe("roadmaps reducer", () => {
  it("adds roadmaps, defaulting omitted slug and description", () => {
    const doc = apply(
      utils.createDocument(),
      addRoadmap({
        id: "r1",
        title: "Q1",
        slug: "q1",
        description: "First quarter",
      }),
      addRoadmap({ id: "r2", title: "Q2" }),
    );

    expect(errors(doc)).toStrictEqual([]);
    expect(state(doc).roadmaps).toStrictEqual([
      {
        id: "r1",
        title: "Q1",
        slug: "q1",
        description: "First quarter",
        milestones: [],
      },
      { id: "r2", title: "Q2", slug: "", description: "", milestones: [] },
    ]);
  });

  it("edits the provided fields and falls back to existing values", () => {
    const doc = apply(
      utils.createDocument(),
      addRoadmap({ id: "r1", title: "Q1", slug: "q1", description: "d" }),
      addRoadmap({ id: "r2", title: "Q2" }),
      editRoadmap({
        id: "r1",
        title: "Q1 revised",
        slug: "q1-rev",
        description: "d2",
      }),
      editRoadmap({ id: "r1" }),
    );

    expect(errors(doc)).toStrictEqual([]);
    expect(state(doc).roadmaps[0]).toMatchObject({
      title: "Q1 revised",
      slug: "q1-rev",
      description: "d2",
    });
    expect(state(doc).roadmaps[1]).toMatchObject({ id: "r2", title: "Q2" });
  });

  it("records an error when editing or removing an unknown roadmap", () => {
    const doc = apply(
      utils.createDocument(),
      editRoadmap({ id: "nope", title: "x" }),
      removeRoadmap({ id: "nope" }),
    );

    expect(errorAt(doc, 0)).toBe("Roadmap not found");
    expect(errorAt(doc, 1)).toBe("Roadmap not found");
  });

  it("removes a roadmap along with deliverables owned by its milestones", () => {
    const doc = apply(
      utils.createDocument(),
      addRoadmap({ id: "r1", title: "Q1" }),
      addMilestone({ id: "m1", roadmapId: "r1", title: "M1" }),
      addMilestoneDeliverable({
        milestoneId: "m1",
        deliverableId: "d-owned",
        title: "Owned",
      }),
      addDeliverable({ id: "d-free", title: "Free" }),
      addRoadmap({ id: "r2", title: "Q2" }),
      removeRoadmap({ id: "r1" }),
    );

    expect(errors(doc)).toStrictEqual([]);
    expect(state(doc).roadmaps.map((r) => r.id)).toStrictEqual(["r2"]);
    expect(state(doc).deliverables.map((d) => d.id)).toStrictEqual(["d-free"]);
  });

  it("removes a roadmap whose milestone has no scope", () => {
    const doc = craft({
      roadmaps: [
        rawRoadmap({
          id: "r1",
          milestones: [rawMilestone({ id: "m1", scope: null })],
        }),
      ],
    });

    const next = apply(doc, removeRoadmap({ id: "r1" }));

    expect(errors(next)).toStrictEqual([]);
    expect(state(next).roadmaps).toStrictEqual([]);
  });
});
