import {
  addCoordinator,
  addDeliverable,
  addMilestone,
  addMilestoneDeliverable,
  addRoadmap,
  editMilestone,
  removeCoordinator,
  removeMilestone,
  removeMilestoneDeliverable,
  setDeliverableBudgetAnchorProject,
  utils,
} from "document-models/scope-of-work/v1";
import { describe, expect, it } from "vitest";
import {
  apply,
  craft,
  errorAt,
  errors,
  lastError,
  rawDeliverable,
  rawMilestone,
  rawRoadmap,
  state,
} from "./reducer-test-helpers.js";
import { percentageProgress } from "../src/reducers/progress.js";

const withMilestone = () =>
  apply(
    utils.createDocument(),
    addRoadmap({ id: "r1", title: "Q1" }),
    addMilestone({
      id: "m1",
      roadmapId: "r1",
      title: "M1",
      sequenceCode: "M-1",
      description: "first",
      deliveryTarget: "2026-12-01",
    }),
    addRoadmap({ id: "r-other", title: "Other" }),
    addMilestone({ id: "m-other", roadmapId: "r-other", title: "Other" }),
  );

const milestone = (doc: ReturnType<typeof withMilestone>, id = "m1") =>
  state(doc)
    .roadmaps.flatMap((r) => r.milestones)
    .find((m) => m.id === id);

describe("milestones reducer", () => {
  describe("addMilestone", () => {
    it("stores the provided fields and a default scope", () => {
      const doc = withMilestone();

      expect(errors(doc)).toStrictEqual([]);
      expect(milestone(doc)).toStrictEqual({
        id: "m1",
        sequenceCode: "M-1",
        title: "M1",
        description: "first",
        deliveryTarget: "2026-12-01",
        coordinators: [],
        scope: {
          deliverables: [],
          status: "DRAFT",
          progress: percentageProgress(0),
          deliverablesCompleted: { total: 0, completed: 0 },
        },
        budget: 0,
      });
    });

    it("defaults omitted text fields to empty strings", () => {
      const doc = apply(
        withMilestone(),
        addMilestone({ id: "m2", roadmapId: "r1" }),
      );

      expect(milestone(doc, "m2")).toMatchObject({
        sequenceCode: "",
        title: "",
        description: "",
        deliveryTarget: "",
      });
    });

    it("records an error for an unknown roadmap", () => {
      const doc = apply(
        utils.createDocument(),
        addMilestone({ id: "m1", roadmapId: "missing" }),
      );

      expect(lastError(doc)).toBe("Roadmap not found");
    });
  });

  describe("editMilestone", () => {
    it("updates provided fields and keeps the rest", () => {
      const doc = apply(
        withMilestone(),
        addMilestone({ id: "m1b", roadmapId: "r1", title: "Sibling" }),
        editMilestone({
          id: "m1",
          roadmapId: "r1",
          title: "M1 v2",
          sequenceCode: "M-1b",
          description: "second",
          deliveryTarget: "2027-01-01",
        }),
        editMilestone({ id: "m1", roadmapId: "r1" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(milestone(doc)).toMatchObject({
        title: "M1 v2",
        sequenceCode: "M-1b",
        description: "second",
        deliveryTarget: "2027-01-01",
      });
      expect(milestone(doc, "m1b")?.title).toBe("Sibling");
    });

    it("records errors for unknown roadmap or milestone", () => {
      const doc = apply(
        withMilestone(),
        editMilestone({ id: "m1", roadmapId: "nope", title: "x" }),
        editMilestone({ id: "nope", roadmapId: "r1", title: "x" }),
      );

      expect(errors(doc)).toStrictEqual([
        "Roadmap not found",
        "Milestone not found",
      ]);
      expect(milestone(doc)?.title).toBe("M1");
    });
  });

  describe("coordinators", () => {
    it("adds a coordinator once and removes it again", () => {
      const doc = apply(
        withMilestone(),
        addCoordinator({ id: "alice", milestoneId: "m1" }),
        addCoordinator({ id: "alice", milestoneId: "m1" }),
        addCoordinator({ id: "bob", milestoneId: "m1" }),
      );
      expect(errors(doc)).toStrictEqual([]);
      expect(milestone(doc)?.coordinators).toStrictEqual(["alice", "bob"]);

      const removed = apply(
        doc,
        removeCoordinator({ id: "alice", milestoneId: "m1" }),
      );
      expect(lastError(removed)).toBeUndefined();
      expect(milestone(removed)?.coordinators).toStrictEqual(["bob"]);
    });

    it("records an error when the milestone is in no roadmap", () => {
      const doc = apply(
        withMilestone(),
        addCoordinator({ id: "alice", milestoneId: "m9" }),
        removeCoordinator({ id: "alice", milestoneId: "m9" }),
      );

      expect(errors(doc)).toStrictEqual([
        "Roadmap with milestone m9 not found",
        "Roadmap with milestone m9 not found",
      ]);
    });
  });

  describe("removeMilestone", () => {
    it("removes the milestone and the deliverables it owns", () => {
      const doc = apply(
        withMilestone(),
        addMilestoneDeliverable({
          milestoneId: "m1",
          deliverableId: "d-owned",
          title: "Owned",
        }),
        addDeliverable({ id: "d-free" }),
        removeMilestone({ id: "m1", roadmapId: "r1" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(state(doc).roadmaps[0].milestones).toStrictEqual([]);
      expect(state(doc).deliverables.map((d) => d.id)).toStrictEqual([
        "d-free",
      ]);
    });

    it("records errors for unknown roadmap or milestone", () => {
      const doc = apply(
        withMilestone(),
        removeMilestone({ id: "m1", roadmapId: "nope" }),
        removeMilestone({ id: "nope", roadmapId: "r1" }),
      );

      expect(errors(doc)).toStrictEqual([
        "Roadmap not found",
        "Milestone not found",
      ]);
      expect(state(doc).roadmaps[0].milestones).toHaveLength(1);
    });

    it("removes a milestone that has no scope", () => {
      const doc = craft({
        roadmaps: [
          rawRoadmap({
            id: "r1",
            milestones: [rawMilestone({ id: "m1", scope: null })],
          }),
        ],
      });

      const next = apply(doc, removeMilestone({ id: "m1", roadmapId: "r1" }));

      expect(errors(next)).toStrictEqual([]);
      expect(state(next).roadmaps[0].milestones).toStrictEqual([]);
    });
  });

  describe("addMilestoneDeliverable", () => {
    it("creates the deliverable and links it into the milestone scope", () => {
      const doc = apply(
        withMilestone(),
        addMilestoneDeliverable({
          milestoneId: "m1",
          deliverableId: "d1",
          title: "Ship it",
        }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(milestone(doc)?.scope?.deliverables).toStrictEqual(["d1"]);
      expect(state(doc).deliverables[0]).toMatchObject({
        id: "d1",
        title: "Ship it",
        status: "DRAFT",
        workProgress: percentageProgress(0),
      });
    });

    it("records an error and adds nothing when the milestone is unknown", () => {
      const doc = apply(
        withMilestone(),
        addMilestoneDeliverable({
          milestoneId: "m9",
          deliverableId: "d1",
          title: "x",
        }),
      );

      expect(lastError(doc)).toBe("Milestone not found");
      expect(state(doc).deliverables).toStrictEqual([]);
    });

    it("records an error when the milestone has no scope", () => {
      const doc = craft({
        roadmaps: [
          rawRoadmap({
            id: "r1",
            milestones: [rawMilestone({ id: "m1", scope: null })],
          }),
        ],
      });

      const next = apply(
        doc,
        addMilestoneDeliverable({
          milestoneId: "m1",
          deliverableId: "d1",
          title: "x",
        }),
      );

      expect(lastError(next)).toBe("Milestone deliverable set not found");
      expect(state(next).deliverables).toStrictEqual([]);
    });
  });

  describe("removeMilestoneDeliverable", () => {
    it("unlinks the deliverable and resets its budget anchor project", () => {
      const doc = apply(
        withMilestone(),
        addMilestoneDeliverable({
          milestoneId: "m1",
          deliverableId: "d1",
          title: "x",
        }),
        addDeliverable({ id: "d-other", title: "Untouched" }),
        setDeliverableBudgetAnchorProject({
          deliverableId: "d1",
          project: "p-external",
          unit: "StoryPoints",
          unitCost: 10,
          quantity: 2,
          margin: 50,
          marginPinned: false,
        }),
      );
      // budget invariant: 10 * 2 * (1 + 50/100) = 30
      expect(milestone(doc)?.budget).toBe(30);

      const next = apply(
        doc,
        removeMilestoneDeliverable({ milestoneId: "m1", deliverableId: "d1" }),
      );

      expect(errors(next)).toStrictEqual([]);
      expect(milestone(next)?.scope?.deliverables).toStrictEqual([]);
      expect(milestone(next)?.budget).toBe(0);
      expect(state(next).deliverables[1]).toMatchObject({
        id: "d-other",
        budgetAnchor: { project: "" },
      });
      expect(state(next).deliverables[0].budgetAnchor).toStrictEqual({
        project: "",
        unit: "StoryPoints",
        unitCost: 10,
        quantity: 2,
        margin: 50,
        marginPinned: false,
      });
    });

    it("falls back to default anchor values when the deliverable had none", () => {
      const doc = craft({
        deliverables: [rawDeliverable({ id: "d1", budgetAnchor: null })],
        roadmaps: [
          rawRoadmap({
            id: "r1",
            milestones: [
              rawMilestone({
                id: "m1",
                scope: {
                  deliverables: ["d1"],
                  status: "DRAFT",
                  progress: percentageProgress(0),
                  deliverablesCompleted: { total: 0, completed: 0 },
                },
              }),
            ],
          }),
        ],
      });

      const next = apply(
        doc,
        removeMilestoneDeliverable({ milestoneId: "m1", deliverableId: "d1" }),
      );

      expect(errors(next)).toStrictEqual([]);
      expect(state(next).deliverables[0].budgetAnchor).toStrictEqual({
        project: "",
        unit: "Hours",
        unitCost: 0,
        quantity: 0,
        margin: 0,
        marginPinned: false,
      });
    });

    it("records errors for unknown milestone or missing scope", () => {
      const doc = craft({
        roadmaps: [
          rawRoadmap({
            id: "r1",
            milestones: [rawMilestone({ id: "m-noscope", scope: null })],
          }),
        ],
      });

      const next = apply(
        doc,
        removeMilestoneDeliverable({ milestoneId: "m9", deliverableId: "d1" }),
        removeMilestoneDeliverable({
          milestoneId: "m-noscope",
          deliverableId: "d1",
        }),
      );

      expect(errorAt(next, 0)).toBe("Roadmap not found");
      expect(errorAt(next, 1)).toBe("Milestone deliverable set not found");
    });
  });
});
