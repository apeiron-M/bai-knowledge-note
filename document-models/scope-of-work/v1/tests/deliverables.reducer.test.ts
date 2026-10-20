import {
  addDeliverable,
  addKeyResult,
  addMilestone,
  addMilestoneDeliverable,
  addProject,
  addProjectDeliverable,
  addRoadmap,
  editDeliverable,
  editKeyResult,
  removeDeliverable,
  removeKeyResult,
  setDeliverableBudgetAnchorProject,
  setDeliverableProgress,
  linkDeliverableGoal,
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

type Doc = ReturnType<typeof utils.createDocument>;
import {
  binaryProgress,
  percentageProgress,
  storyPointsProgress,
} from "../src/reducers/progress.js";

const deliverable = (
  doc: ReturnType<typeof utils.createDocument>,
  id: string,
) => state(doc).deliverables.find((d) => d.id === id);

/** One project deliverable, one milestone deliverable, one standalone. */
const populated = (start = utils.createDocument()) =>
  apply(
    start,
    addProject({ id: "p1", code: "P1", title: "Project" }),
    addProjectDeliverable({
      projectId: "p1",
      deliverableId: "d-proj",
      title: "In project",
    }),
    addRoadmap({ id: "r1", title: "Roadmap" }),
    addMilestone({ id: "m1", roadmapId: "r1", title: "Milestone" }),
    addMilestoneDeliverable({
      milestoneId: "m1",
      deliverableId: "d-mile",
      title: "In milestone",
    }),
    addDeliverable({ id: "d-free", title: "Standalone" }),
  );

describe("deliverables reducer", () => {
  describe("addDeliverable", () => {
    it("stores provided fields, and defaults the rest", () => {
      const doc = apply(
        utils.createDocument(),
        addDeliverable({
          id: "d1",
          owner: "alice",
          title: "Full",
          code: "D-1",
          description: "desc",
          status: "TODO",
        }),
        addDeliverable({ id: "d2" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(deliverable(doc, "d1")).toMatchObject({
        owner: "alice",
        title: "Full",
        code: "D-1",
        description: "desc",
        status: "TODO",
        icon: null,
        workProgress: null,
        keyResults: [],
      });
      expect(deliverable(doc, "d2")).toMatchObject({
        owner: null,
        title: "",
        code: "",
        description: "",
        status: "DRAFT",
        budgetAnchor: {
          project: "",
          unit: "Hours",
          unitCost: 0,
          quantity: 0,
          margin: 0,
        },
      });
    });
  });

  describe("removeDeliverable", () => {
    it("removes a deliverable from the project scope that owns it", () => {
      const doc = apply(populated(), removeDeliverable({ id: "d-proj" }));

      expect(errors(doc)).toStrictEqual([]);
      expect(state(doc).projects[0].scope?.deliverables).toStrictEqual([]);
      expect(deliverable(doc, "d-proj")).toBeUndefined();
      expect(state(doc).deliverables).toHaveLength(2);
    });

    it("removes a deliverable from the milestone scope that owns it", () => {
      const doc = apply(populated(), removeDeliverable({ id: "d-mile" }));

      expect(errors(doc)).toStrictEqual([]);
      expect(
        state(doc).roadmaps[0].milestones[0].scope?.deliverables,
      ).toStrictEqual([]);
      expect(deliverable(doc, "d-mile")).toBeUndefined();
    });

    it("removes a standalone deliverable without touching any scope", () => {
      const doc = apply(populated(), removeDeliverable({ id: "d-free" }));

      expect(errors(doc)).toStrictEqual([]);
      expect(state(doc).projects[0].scope?.deliverables).toStrictEqual([
        "d-proj",
      ]);
      expect(
        state(doc).roadmaps[0].milestones[0].scope?.deliverables,
      ).toStrictEqual(["d-mile"]);
      expect(state(doc).deliverables.map((d) => d.id)).toStrictEqual([
        "d-proj",
        "d-mile",
      ]);
    });

    it("skips milestones with no scope while searching for the owner", () => {
      const doc = populated(
        craft({
          roadmaps: [
            rawRoadmap({
              id: "r0",
              milestones: [rawMilestone({ id: "m0", scope: null })],
            }),
          ],
        }),
      );

      const next = apply(doc, removeDeliverable({ id: "d-mile" }));

      expect(errors(next)).toStrictEqual([]);
      expect(deliverable(next, "d-mile")).toBeUndefined();
    });

    it("records an error for an unknown deliverable", () => {
      const doc = apply(populated(), removeDeliverable({ id: "nope" }));

      expect(lastError(doc)).toBe("Deliverable not found");
      expect(state(doc).deliverables).toHaveLength(3);
    });
  });

  describe("editDeliverable", () => {
    it("updates provided fields, keeps omitted ones, and maps nulls to defaults", () => {
      const doc = apply(
        populated(),
        editDeliverable({
          id: "d-free",
          owner: "bob",
          icon: "rocket",
          title: "Renamed",
          code: "X-1",
          description: "new",
          status: "IN_PROGRESS",
        }),
        editDeliverable({ id: "d-free" }),
      );
      expect(errors(doc)).toStrictEqual([]);
      expect(deliverable(doc, "d-free")).toMatchObject({
        owner: "bob",
        icon: "rocket",
        title: "Renamed",
        code: "X-1",
        description: "new",
        status: "IN_PROGRESS",
      });

      const nulled = apply(
        doc,
        editDeliverable({
          id: "d-free",
          owner: null,
          icon: null,
          title: null,
          code: null,
          description: null,
          status: null,
        }),
      );
      expect(lastError(nulled)).toBeUndefined();
      expect(deliverable(nulled, "d-free")).toMatchObject({
        owner: null,
        icon: null,
        title: "",
        code: "",
        description: "",
        status: "IN_PROGRESS",
      });
    });

    it("records an error for an unknown deliverable", () => {
      const doc = apply(
        populated(),
        editDeliverable({ id: "nope", title: "x" }),
      );
      expect(lastError(doc)).toBe("Deliverable not found");
    });
  });

  describe("setDeliverableProgress", () => {
    it("moves to IN_PROGRESS and stores percentage progress", () => {
      const doc = apply(
        populated(),
        setDeliverableProgress({
          id: "d-proj",
          workProgress: { percentage: 40 },
        }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(deliverable(doc, "d-proj")).toMatchObject({
        status: "IN_PROGRESS",
        workProgress: percentageProgress(40),
      });
      expect(state(doc).projects[0].scope).toMatchObject({
        progress: percentageProgress(40),
        deliverablesCompleted: { total: 1, completed: 0 },
      });
    });

    it("marks the deliverable DELIVERED at 100 percent", () => {
      const doc = apply(
        populated(),
        setDeliverableProgress({
          id: "d-proj",
          workProgress: { percentage: 100 },
        }),
      );

      expect(deliverable(doc, "d-proj")?.status).toBe("DELIVERED");
      expect(state(doc).projects[0].scope?.deliverablesCompleted).toStrictEqual(
        {
          total: 1,
          completed: 1,
        },
      );
    });

    it("stores story points and completes only when all points are done", () => {
      const doc = apply(
        populated(),
        setDeliverableProgress({
          id: "d-free",
          workProgress: {
            percentage: null,
            storyPoints: { total: 5, completed: 2 },
          },
        }),
      );
      expect(deliverable(doc, "d-free")).toMatchObject({
        status: "IN_PROGRESS",
        workProgress: storyPointsProgress(5, 2),
      });

      const done = apply(
        doc,
        setDeliverableProgress({
          id: "d-free",
          workProgress: { storyPoints: { total: 5, completed: 5 } },
        }),
      );
      expect(deliverable(done, "d-free")?.status).toBe("DELIVERED");

      const zero = apply(
        doc,
        setDeliverableProgress({
          id: "d-free",
          workProgress: { storyPoints: { total: 0, completed: 0 } },
        }),
      );
      expect(deliverable(zero, "d-free")?.status).toBe("IN_PROGRESS");
    });

    it("stores binary progress and completes when done", () => {
      const doc = apply(
        populated(),
        setDeliverableProgress({
          id: "d-free",
          workProgress: binaryProgress(false),
        }),
      );
      expect(deliverable(doc, "d-free")).toMatchObject({
        status: "IN_PROGRESS",
        workProgress: binaryProgress(false),
      });

      const done = apply(
        doc,
        setDeliverableProgress({
          id: "d-free",
          workProgress: binaryProgress(true),
        }),
      );
      expect(deliverable(done, "d-free")).toMatchObject({
        status: "DELIVERED",
        workProgress: binaryProgress(true),
      });
    });

    it("keeps existing progress when none, an empty object, or all-null is given", () => {
      const doc = apply(
        populated(),
        setDeliverableProgress({ id: "d-free" }),
        setDeliverableProgress({ id: "d-free", workProgress: {} }),
        setDeliverableProgress({
          id: "d-free",
          workProgress: { percentage: null, storyPoints: null, done: null },
        }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(deliverable(doc, "d-free")).toMatchObject({
        status: "IN_PROGRESS",
        workProgress: null,
      });
    });

    it("records an error for an unknown deliverable", () => {
      const doc = apply(
        populated(),
        setDeliverableProgress({
          id: "nope",
          workProgress: binaryProgress(true),
        }),
      );
      expect(lastError(doc)).toBe("Deliverable not found");
    });
  });

  describe("key results", () => {
    it("adds key results with and without a link", () => {
      const doc = apply(
        populated(),
        addKeyResult({
          id: "k1",
          deliverableId: "d-free",
          title: "Launch",
          link: "https://example.com",
        }),
        addKeyResult({ id: "k2", deliverableId: "d-free", title: "" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(deliverable(doc, "d-free")?.keyResults).toStrictEqual([
        { id: "k1", title: "Launch", link: "https://example.com" },
        { id: "k2", title: "", link: "" },
      ]);
    });

    it("edits an existing key result, keeping fields that are not provided", () => {
      const doc = apply(
        populated(),
        addKeyResult({
          id: "k1",
          deliverableId: "d-free",
          title: "Launch",
          link: "https://a.example",
        }),
        editKeyResult({
          id: "k1",
          deliverableId: "d-free",
          title: "Launch v2",
          link: "https://b.example",
        }),
        editKeyResult({ id: "k1", deliverableId: "d-free" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(deliverable(doc, "d-free")?.keyResults).toStrictEqual([
        { id: "k1", title: "Launch v2", link: "https://b.example" },
      ]);
    });

    it("leaves key results untouched when editing an id that does not exist", () => {
      const doc = apply(
        populated(),
        addKeyResult({ id: "k1", deliverableId: "d-free", title: "Launch" }),
        editKeyResult({ id: "k-missing", deliverableId: "d-free", title: "x" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(deliverable(doc, "d-free")?.keyResults).toStrictEqual([
        { id: "k1", title: "Launch", link: "" },
      ]);
    });

    it("removes a key result", () => {
      const doc = apply(
        populated(),
        addKeyResult({ id: "k1", deliverableId: "d-free", title: "A" }),
        addKeyResult({ id: "k2", deliverableId: "d-free", title: "B" }),
        removeKeyResult({ id: "k1", deliverableId: "d-free" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(
        deliverable(doc, "d-free")?.keyResults.map((k) => k.id),
      ).toStrictEqual(["k2"]);
    });

    it("records an error when the deliverable is unknown", () => {
      const doc = apply(
        populated(),
        addKeyResult({ id: "k1", deliverableId: "nope", title: "A" }),
        removeKeyResult({ id: "k1", deliverableId: "nope" }),
        editKeyResult({ id: "k1", deliverableId: "nope", title: "A" }),
      );

      expect(errorAt(doc, 6)).toBe("Deliverable not found");
      expect(errorAt(doc, 7)).toBe("Deliverable not found");
      expect(errorAt(doc, 8)).toBe("Deliverable not found");
    });
  });

  describe("setDeliverableBudgetAnchorProject", () => {
    it("merges anchor fields and recomputes the owning project's budget", () => {
      const doc = apply(
        populated(),
        setDeliverableBudgetAnchorProject({
          deliverableId: "d-proj",
          unit: "StoryPoints",
          unitCost: 100,
          quantity: 3,
          margin: 10,
          marginPinned: true,
        }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(deliverable(doc, "d-proj")?.budgetAnchor).toStrictEqual({
        project: "p1",
        unit: "StoryPoints",
        unitCost: 100,
        quantity: 3,
        margin: 10,
        marginPinned: true,
      });
      // 100 * 3 * 1.10
      expect(state(doc).projects[0].budget).toBe(330);
    });

    it("records an error for an unknown deliverable", () => {
      const doc = apply(
        populated(),
        setDeliverableBudgetAnchorProject({ deliverableId: "nope", margin: 1 }),
      );
      expect(lastError(doc)).toBe("Deliverable not found");
    });
  });
});

describe("linkDeliverableGoal (deliverable ↔ WBS goal join)", () => {
  const seeded = () => craft({ deliverables: [rawDeliverable({ id: "d1" })] });
  const deliverable = (doc: Doc, id = "d1") =>
    state(doc).deliverables.find((d) => d.id === id);

  it("a new deliverable starts unlinked", () => {
    const doc = apply(utils.createDocument(), addDeliverable({ id: "d9" }));
    expect(deliverable(doc, "d9")?.goalRef).toBeNull();
  });

  it("links a goal and a null or omitted goalRef unlinks it", () => {
    let doc = apply(seeded(), linkDeliverableGoal({ deliverableId: "d1", goalRef: "goal-4" }));
    expect(deliverable(doc)?.goalRef).toBe("goal-4");
    doc = apply(doc, linkDeliverableGoal({ deliverableId: "d1", goalRef: null }));
    expect(deliverable(doc)?.goalRef).toBeNull();
    doc = apply(doc, linkDeliverableGoal({ deliverableId: "d1", goalRef: "goal-5" }));
    doc = apply(doc, linkDeliverableGoal({ deliverableId: "d1" }));
    expect(deliverable(doc)?.goalRef).toBeNull();
    expect(errors(doc)).toEqual([]);
  });

  it("reports DeliverableNotFound for an unknown deliverable and changes nothing", () => {
    const doc = apply(seeded(), linkDeliverableGoal({ deliverableId: "nope", goalRef: "g" }));
    expect(lastError(doc)).toBe("Deliverable nope not found");
    expect(deliverable(doc)?.goalRef).toBeNull();
  });
});
