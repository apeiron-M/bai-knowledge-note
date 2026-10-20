import {
  addDeliverable,
  addDeliverableInSet,
  addMilestone,
  addProject,
  addRoadmap,
  editDeliverablesSet,
  removeDeliverableInSet,
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
  rawProject,
  rawRoadmap,
  state,
} from "./reducer-test-helpers.js";
import { percentageProgress } from "../src/reducers/progress.js";

/** A roadmap with one milestone, one project and two free deliverables. */
const base = () =>
  apply(
    utils.createDocument(),
    addRoadmap({ id: "r1", title: "Roadmap" }),
    addMilestone({ id: "m1", roadmapId: "r1", title: "Milestone" }),
    addProject({ id: "p1", code: "P1", title: "Project" }),
    addDeliverable({ id: "d1", title: "One" }),
    addDeliverable({ id: "d2", title: "Two" }),
    addRoadmap({ id: "r-other", title: "Other" }),
    addMilestone({ id: "m-other", roadmapId: "r-other" }),
    addProject({ id: "p-other", code: "PO", title: "Other" }),
  );

const milestoneScope = (doc: ReturnType<typeof base>) =>
  state(doc).roadmaps[0].milestones[0].scope;
const projectScope = (doc: ReturnType<typeof base>) =>
  state(doc).projects[0].scope;
const anchorOf = (doc: ReturnType<typeof base>, id: string) =>
  state(doc).deliverables.find((d) => d.id === id)?.budgetAnchor;

/** Same as base(), but the milestone and project have a null scope. */
const withoutScopes = () => {
  const doc = craft({
    roadmaps: [
      rawRoadmap({
        id: "r1",
        milestones: [rawMilestone({ id: "m1", scope: null })],
      }),
    ],
    projects: [rawProject({ id: "p1", scope: null })],
    deliverables: [rawDeliverable({ id: "d1", budgetAnchor: null })],
  });
  return doc;
};

describe("deliverables-set reducer", () => {
  describe("editDeliverablesSet", () => {
    it("updates a milestone scope's status and completion, keeping them when omitted", () => {
      const doc = apply(
        base(),
        editDeliverablesSet({
          milestoneId: "m1",
          status: "IN_PROGRESS",
          deliverablesCompleted: { total: 4, completed: 1 },
        }),
        editDeliverablesSet({ milestoneId: "m1" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(milestoneScope(doc)).toMatchObject({ status: "IN_PROGRESS" });
      // the progress invariant recomputes completion from the (empty) set afterwards
      expect(milestoneScope(doc)?.deliverablesCompleted).toStrictEqual({
        total: 0,
        completed: 0,
      });
    });

    it("updates a project scope's status and completion, keeping them when omitted", () => {
      const doc = apply(
        base(),
        editDeliverablesSet({
          projectId: "p1",
          status: "FINISHED",
          deliverablesCompleted: { total: 2, completed: 2 },
        }),
        editDeliverablesSet({ projectId: "p1" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(projectScope(doc)).toMatchObject({
        status: "FINISHED",
        deliverables: [],
      });
    });

    it("rebuilds a project scope from defaults when it was missing", () => {
      const doc = apply(
        withoutScopes(),
        editDeliverablesSet({ projectId: "p1" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(projectScope(doc)).toStrictEqual({
        deliverables: [],
        status: "DRAFT",
        progress: percentageProgress(0),
        deliverablesCompleted: { total: 0, completed: 0 },
      });
    });

    it("records errors for unknown milestone, missing milestone scope and unknown project", () => {
      const doc = apply(
        withoutScopes(),
        editDeliverablesSet({ milestoneId: "m9", status: "TODO" }),
        editDeliverablesSet({ milestoneId: "m1", status: "TODO" }),
        editDeliverablesSet({ projectId: "p9", status: "TODO" }),
      );

      expect(errorAt(doc, 0)).toBe("Roadmap with milestone not found");
      expect(errorAt(doc, 1)).toBe("Milestone or scope not found");
      expect(errorAt(doc, 2)).toBe("Project with id p9 not found");
    });

    it("does nothing when neither or both ids are given", () => {
      const before = base();
      const doc = apply(
        before,
        editDeliverablesSet({ status: "CANCELED" }),
        editDeliverablesSet({
          milestoneId: "m1",
          projectId: "p1",
          status: "CANCELED",
        }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(milestoneScope(doc)?.status).toBe("DRAFT");
      expect(projectScope(doc)?.status).toBe("DRAFT");
    });
  });

  describe("addDeliverableInSet", () => {
    it("requires a milestone or project id", () => {
      const doc = apply(base(), addDeliverableInSet({ deliverableId: "d1" }));
      expect(lastError(doc)).toBe(
        "Either milestoneId or projectId must be provided",
      );
    });

    it("links a deliverable into a milestone scope exactly once", () => {
      const doc = apply(
        base(),
        addDeliverableInSet({ deliverableId: "d1", milestoneId: "m1" }),
        addDeliverableInSet({ deliverableId: "d1", milestoneId: "m1" }),
        addDeliverableInSet({ deliverableId: "d2", milestoneId: "m1" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(milestoneScope(doc)?.deliverables).toStrictEqual(["d1", "d2"]);
      expect(milestoneScope(doc)?.deliverablesCompleted).toStrictEqual({
        total: 2,
        completed: 0,
      });
    });

    it("links a deliverable into a project scope and points its anchor at the project", () => {
      const doc = apply(
        base(),
        setDeliverableBudgetAnchorProject({
          deliverableId: "d1",
          unit: "StoryPoints",
          unitCost: 5,
          quantity: 4,
          margin: 25,
          marginPinned: false,
        }),
        addDeliverableInSet({ deliverableId: "d1", projectId: "p1" }),
        addDeliverableInSet({ deliverableId: "d1", projectId: "p1" }),
        addDeliverableInSet({ deliverableId: "d2", projectId: "p1" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(projectScope(doc)?.deliverables).toStrictEqual(["d1", "d2"]);
      expect(anchorOf(doc, "d1")).toStrictEqual({
        project: "p1",
        unit: "StoryPoints",
        unitCost: 5,
        quantity: 4,
        margin: 25,
        marginPinned: false,
      });
      expect(anchorOf(doc, "d2")).toStrictEqual({
        project: "p1",
        unit: "Hours",
        unitCost: 0,
        quantity: 0,
        margin: 0,
        marginPinned: false,
      });
    });

    it("creates the scope when the milestone or project has none", () => {
      const doc = apply(
        withoutScopes(),
        addDeliverableInSet({ deliverableId: "d1", milestoneId: "m1" }),
        addDeliverableInSet({ deliverableId: "d1", projectId: "p1" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(milestoneScope(doc)?.deliverables).toStrictEqual(["d1"]);
      expect(milestoneScope(doc)?.status).toBe("DRAFT");
      expect(projectScope(doc)?.deliverables).toStrictEqual(["d1"]);
      // deliverable had no anchor: a default one is built pointing at the project
      expect(anchorOf(doc, "d1")).toStrictEqual({
        project: "p1",
        unit: "Hours",
        unitCost: 0,
        quantity: 0,
        margin: 0,
        marginPinned: false,
      });
    });

    it("records errors for unknown milestone or project", () => {
      const doc = apply(
        base(),
        addDeliverableInSet({ deliverableId: "d1", milestoneId: "m9" }),
        addDeliverableInSet({ deliverableId: "d1", projectId: "p9" }),
      );

      expect(errors(doc)).toStrictEqual([
        "Roadmap with milestone m9 not found",
        "Project with id p9 not found",
      ]);
    });

    it("does nothing when both ids are given", () => {
      const doc = apply(
        base(),
        addDeliverableInSet({
          deliverableId: "d1",
          milestoneId: "m1",
          projectId: "p1",
        }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(milestoneScope(doc)?.deliverables).toStrictEqual([]);
      expect(projectScope(doc)?.deliverables).toStrictEqual([]);
    });
  });

  describe("removeDeliverableInSet", () => {
    it("unlinks a deliverable from a milestone scope", () => {
      const doc = apply(
        base(),
        addDeliverableInSet({ deliverableId: "d1", milestoneId: "m1" }),
        addDeliverableInSet({ deliverableId: "d2", milestoneId: "m1" }),
        removeDeliverableInSet({ deliverableId: "d1", milestoneId: "m1" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(milestoneScope(doc)?.deliverables).toStrictEqual(["d2"]);
    });

    it("unlinks a deliverable from a project scope and clears its anchor project", () => {
      const doc = apply(
        base(),
        setDeliverableBudgetAnchorProject({
          deliverableId: "d1",
          unitCost: 7,
          quantity: 2,
          margin: 10,
          unit: "StoryPoints",
        }),
        addDeliverableInSet({ deliverableId: "d1", projectId: "p1" }),
        addDeliverableInSet({ deliverableId: "d2", projectId: "p1" }),
        removeDeliverableInSet({ deliverableId: "d1", projectId: "p1" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(projectScope(doc)?.deliverables).toStrictEqual(["d2"]);
      expect(anchorOf(doc, "d1")).toStrictEqual({
        project: "",
        unit: "StoryPoints",
        unitCost: 7,
        quantity: 2,
        margin: 10,
        marginPinned: true, // the margin was typed, so it travels pinned
      });
    });

    it("falls back to default anchor values for a deliverable with no anchor", () => {
      const doc = craft({
        projects: [
          rawProject({
            id: "p1",
            scope: {
              deliverables: ["d1"],
              status: "DRAFT",
              progress: percentageProgress(0),
              deliverablesCompleted: { total: 0, completed: 0 },
            },
          }),
        ],
        deliverables: [rawDeliverable({ id: "d1", budgetAnchor: null })],
      });

      const next = apply(
        doc,
        removeDeliverableInSet({ deliverableId: "d1", projectId: "p1" }),
      );

      expect(errors(next)).toStrictEqual([]);
      expect(anchorOf(next, "d1")).toStrictEqual({
        project: "",
        unit: "Hours",
        unitCost: 0,
        quantity: 0,
        margin: 0,
        marginPinned: false,
      });
    });

    it("records errors for unknown ids and missing scopes", () => {
      const doc = apply(
        withoutScopes(),
        removeDeliverableInSet({ deliverableId: "d1", milestoneId: "m9" }),
        removeDeliverableInSet({ deliverableId: "d1", milestoneId: "m1" }),
        removeDeliverableInSet({ deliverableId: "d1", projectId: "p9" }),
        removeDeliverableInSet({ deliverableId: "d1", projectId: "p1" }),
      );

      expect(errorAt(doc, 0)).toBe("Roadmap with milestone not found");
      expect(errorAt(doc, 1)).toBe("Milestone scope not found");
      expect(errorAt(doc, 2)).toBe("Project with id p9 not found");
      expect(errorAt(doc, 3)).toBe("Project scope not found for project p1");
    });

    it("does nothing when neither id is given", () => {
      const doc = apply(
        base(),
        addDeliverableInSet({ deliverableId: "d1", milestoneId: "m1" }),
        removeDeliverableInSet({ deliverableId: "d1" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(milestoneScope(doc)?.deliverables).toStrictEqual(["d1"]);
    });
  });
});
