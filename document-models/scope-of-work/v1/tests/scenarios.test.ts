/**
 * Battle tests: realistic multi-step flows through the ScopeOfWork reducers,
 * asserting the derived aggregates (budgets, margins, progress, completion)
 * after every step — plus an executable list of known gaps.
 *
 * The "former gaps" block holds the regression tests for the logic holes the
 * first version of this suite uncovered; each states the desired behaviour.
 */
import {
  addAgent,
  addCoordinator,
  addDeliverableInSet,
  addKeyResult,
  addMilestone,
  addProject,
  addProjectDeliverable,
  addRoadmap,
  editDeliverable,
  editDeliverablesSet,
  editMilestone,
  editRoadmap,
  editScopeOfWork,
  removeAgent,
  removeDeliverable,
  removeMilestone,
  removeProject,
  removeProjectDeliverable,
  removeRoadmap,
  setDeliverableBudgetAnchorProject,
  setDeliverableProgress,
  setProjectMargin,
  setProjectTotalBudget,
  updateProject,
  utils,
} from "document-models/scope-of-work/v1";
import { describe, expect, it } from "vitest";
import {
  percentageProgress,
  storyPointsProgress,
} from "../src/reducers/progress.js";
import {
  apply,
  errors,
  lastError,
  state,
  type Doc,
} from "./reducer-test-helpers.js";

const project = (doc: Doc, id = "p1") =>
  state(doc).projects.find((p) => p.id === id);
const milestone = (doc: Doc, id: string) =>
  state(doc)
    .roadmaps.flatMap((r) => r.milestones)
    .find((m) => m.id === id);
const deliverable = (doc: Doc, id: string) =>
  state(doc).deliverables.find((d) => d.id === id);
const anchor = (doc: Doc, id: string) => deliverable(doc, id)?.budgetAnchor;

/**
 * Two contributors, one roadmap with two milestones, one project with two
 * deliverables — and each deliverable is also scheduled into a milestone, so
 * every aggregate has to be kept in sync across BOTH containers.
 */
const plannedScope = () =>
  apply(
    utils.createDocument(),
    editScopeOfWork({
      title: "Platform Q3",
      description: "Ship the public API and the web UI",
      status: "DRAFT",
    }),
    addAgent({ id: "alice", name: "Alice" }),
    addAgent({ id: "bob", name: "Bob" }),
    addRoadmap({ id: "r1", title: "2026 H2" }),
    addMilestone({
      id: "m1",
      roadmapId: "r1",
      title: "Alpha",
      sequenceCode: "M1",
    }),
    addMilestone({
      id: "m2",
      roadmapId: "r1",
      title: "Beta",
      sequenceCode: "M2",
    }),
    addCoordinator({ id: "alice", milestoneId: "m1" }),
    addProject({
      id: "p1",
      code: "PLT",
      title: "Platform",
      projectOwner: "bob",
    }),
    addProjectDeliverable({
      projectId: "p1",
      deliverableId: "api",
      title: "Public API",
    }),
    addProjectDeliverable({
      projectId: "p1",
      deliverableId: "ui",
      title: "Web UI",
    }),
    addDeliverableInSet({ deliverableId: "api", milestoneId: "m1" }),
    addDeliverableInSet({ deliverableId: "ui", milestoneId: "m2" }),
    editDeliverable({ id: "api", owner: "alice" }),
    editDeliverable({ id: "ui", owner: "bob" }),
  );

/** plannedScope + costs: api 100×10 @20% = 1200, ui 50×10 @20% = 600. */
const costedScope = () =>
  apply(
    plannedScope(),
    setDeliverableBudgetAnchorProject({
      deliverableId: "api",
      unitCost: 100,
      quantity: 10,
      margin: 20,
    }),
    setDeliverableBudgetAnchorProject({
      deliverableId: "ui",
      unitCost: 50,
      quantity: 10,
      margin: 20,
    }),
  );

describe("scenario: planning", () => {
  it("wires deliverables into both their project and their milestone", () => {
    const doc = plannedScope();

    expect(errors(doc)).toStrictEqual([]);
    expect(state(doc)).toMatchObject({ title: "Platform Q3", status: "DRAFT" });
    expect(state(doc).contributors.map((a) => a.id)).toStrictEqual([
      "alice",
      "bob",
    ]);
    expect(project(doc)?.scope?.deliverables).toStrictEqual(["api", "ui"]);
    expect(milestone(doc, "m1")?.scope?.deliverables).toStrictEqual(["api"]);
    expect(milestone(doc, "m2")?.scope?.deliverables).toStrictEqual(["ui"]);
    expect(milestone(doc, "m1")?.coordinators).toStrictEqual(["alice"]);
    // deliverables created through a project are anchored to it from birth
    expect(anchor(doc, "api")?.project).toBe("p1");
    expect(anchor(doc, "ui")?.project).toBe("p1");
    expect(deliverable(doc, "api")).toMatchObject({
      owner: "alice",
      status: "DRAFT",
    });
    // nothing is costed yet, so every derived budget is zero
    expect(project(doc)?.budget).toBe(0);
    expect(milestone(doc, "m1")?.budget).toBe(0);
    expect(project(doc)?.scope?.deliverablesCompleted).toStrictEqual({
      total: 2,
      completed: 0,
    });
  });
});

describe("scenario: budgeting", () => {
  it("derives project AND milestone budgets from the deliverable anchors", () => {
    const doc = costedScope();

    expect(errors(doc)).toStrictEqual([]);
    expect(project(doc)?.budget).toBe(1800);
    expect(milestone(doc, "m1")?.budget).toBe(1200);
    expect(milestone(doc, "m2")?.budget).toBe(600);
  });

  it("re-prices every container when the project margin changes", () => {
    const doc = apply(
      costedScope(),
      setProjectMargin({ projectId: "p1", margin: 50 }),
    );

    expect(errors(doc)).toStrictEqual([]);
    expect(anchor(doc, "api")?.margin).toBe(50);
    expect(anchor(doc, "ui")?.margin).toBe(50);
    expect(project(doc)?.budget).toBe(2250); // (1000 + 500) × 1.5
    expect(milestone(doc, "m1")?.budget).toBe(1500);
    expect(milestone(doc, "m2")?.budget).toBe(750);
  });

  it("re-prices when a single deliverable is re-quoted", () => {
    const doc = apply(
      costedScope(),
      setDeliverableBudgetAnchorProject({ deliverableId: "ui", quantity: 20 }),
    );

    expect(project(doc)?.budget).toBe(2400); // 1200 + 50×20×1.2
    expect(milestone(doc, "m2")?.budget).toBe(1200);
    expect(milestone(doc, "m1")?.budget).toBe(1200); // untouched
  });

  it("moving a deliverable out of a project removes its cost from that project only", () => {
    const doc = apply(
      costedScope(),
      removeProjectDeliverable({ projectId: "p1", deliverableId: "ui" }),
    );

    expect(errors(doc)).toStrictEqual([]);
    expect(project(doc)?.scope?.deliverables).toStrictEqual(["api"]);
    expect(project(doc)?.budget).toBe(1200);
    expect(anchor(doc, "ui")?.project).toBe(""); // detached, but keeps its quote
    expect(anchor(doc, "ui")).toMatchObject({
      unitCost: 50,
      quantity: 10,
      margin: 20,
    });
    // the milestone still schedules it, so the milestone keeps its budget
    expect(milestone(doc, "m2")?.scope?.deliverables).toStrictEqual(["ui"]);
    expect(milestone(doc, "m2")?.budget).toBe(600);
  });
});

describe("scenario: delivery", () => {
  it("rolls progress up into the project and the milestones as work lands", () => {
    let doc = apply(costedScope(), editScopeOfWork({ status: "IN_PROGRESS" }));

    // api half done (percentage); ui untouched
    doc = apply(
      doc,
      setDeliverableProgress({ id: "api", workProgress: { percentage: 50 } }),
    );
    expect(deliverable(doc, "api")?.status).toBe("IN_PROGRESS");
    expect(project(doc)?.scope?.progress).toStrictEqual(percentageProgress(25));
    expect(project(doc)?.scope?.deliverablesCompleted).toStrictEqual({
      total: 2,
      completed: 0,
    });
    expect(milestone(doc, "m1")?.scope?.progress).toStrictEqual(
      percentageProgress(50),
    );
    expect(milestone(doc, "m2")?.scope?.progress).toStrictEqual(
      percentageProgress(0),
    );

    // ui tracked in story points: 2 of 8 -> 25% equivalent; project mixes both kinds
    doc = apply(
      doc,
      setDeliverableProgress({
        id: "ui",
        workProgress: { storyPoints: { total: 8, completed: 2 } },
      }),
    );
    expect(project(doc)?.scope?.progress).toStrictEqual(
      percentageProgress(37.5),
    );
    // a milestone whose deliverables are ALL story points aggregates in story points
    expect(milestone(doc, "m2")?.scope?.progress).toStrictEqual(
      storyPointsProgress(8, 2),
    );
    expect(milestone(doc, "m2")?.scope?.deliverablesCompleted).toStrictEqual({
      total: 1,
      completed: 0,
    });

    // api completes -> DELIVERED, counted as completed everywhere it appears
    doc = apply(
      doc,
      setDeliverableProgress({ id: "api", workProgress: { percentage: 100 } }),
    );
    expect(deliverable(doc, "api")?.status).toBe("DELIVERED");
    expect(project(doc)?.scope?.progress).toStrictEqual(
      percentageProgress(62.5),
    );
    expect(project(doc)?.scope?.deliverablesCompleted).toStrictEqual({
      total: 2,
      completed: 1,
    });
    expect(milestone(doc, "m1")?.scope).toMatchObject({
      progress: percentageProgress(100),
      deliverablesCompleted: { total: 1, completed: 1 },
    });

    // ui completes all its points -> DELIVERED; everything reads 100%
    doc = apply(
      doc,
      setDeliverableProgress({
        id: "ui",
        workProgress: { storyPoints: { total: 8, completed: 8 } },
      }),
    );
    expect(deliverable(doc, "ui")?.status).toBe("DELIVERED");
    expect(project(doc)?.scope?.progress).toStrictEqual(
      percentageProgress(100),
    );
    expect(project(doc)?.scope?.deliverablesCompleted).toStrictEqual({
      total: 2,
      completed: 2,
    });
    expect(milestone(doc, "m2")?.scope).toMatchObject({
      progress: storyPointsProgress(8, 8),
      deliverablesCompleted: { total: 1, completed: 1 },
    });

    // close out
    doc = apply(
      doc,
      editDeliverablesSet({ projectId: "p1", status: "FINISHED" }),
      editDeliverablesSet({ milestoneId: "m1", status: "FINISHED" }),
      editDeliverablesSet({ milestoneId: "m2", status: "FINISHED" }),
      editScopeOfWork({ status: "DELIVERED" }),
    );
    expect(errors(doc)).toStrictEqual([]);
    expect(project(doc)?.scope?.status).toBe("FINISHED");
    expect(state(doc).status).toBe("DELIVERED");
    // budgets were never disturbed by progress
    expect(project(doc)?.budget).toBe(1800);
  });

  it("cancelling a deliverable takes it out of the progress denominator", () => {
    const doc = apply(
      costedScope(),
      setDeliverableProgress({ id: "api", workProgress: { percentage: 100 } }),
      editDeliverable({ id: "ui", status: "CANCELED" }),
    );

    expect(project(doc)?.scope?.progress).toStrictEqual(
      percentageProgress(100),
    );
    expect(project(doc)?.scope?.deliverablesCompleted).toStrictEqual({
      total: 1,
      completed: 1,
    });
    expect(milestone(doc, "m2")?.scope?.deliverablesCompleted).toStrictEqual({
      total: 0,
      completed: 0,
    });
    // ...but its cost still counts until it is actually removed
    expect(project(doc)?.budget).toBe(1800);
  });

  it("keeps key results attached through progress and status changes", () => {
    const doc = apply(
      costedScope(),
      addKeyResult({
        id: "kr1",
        deliverableId: "api",
        title: "p99 < 200ms",
        link: "https://dash.example",
      }),
      setDeliverableProgress({ id: "api", workProgress: { percentage: 100 } }),
      editDeliverable({ id: "api", description: "shipped" }),
    );

    expect(deliverable(doc, "api")).toMatchObject({
      status: "DELIVERED",
      description: "shipped",
      keyResults: [
        { id: "kr1", title: "p99 < 200ms", link: "https://dash.example" },
      ],
    });
  });
});

describe("scenario: restructuring", () => {
  it("deleting a deliverable pulls it out of every container and re-derives everything", () => {
    const doc = apply(
      costedScope(),
      setDeliverableProgress({ id: "ui", workProgress: { percentage: 100 } }),
      removeDeliverable({ id: "api" }),
    );

    expect(errors(doc)).toStrictEqual([]);
    expect(deliverable(doc, "api")).toBeUndefined();
    expect(project(doc)?.scope?.deliverables).toStrictEqual(["ui"]);
    expect(milestone(doc, "m1")?.scope?.deliverables).toStrictEqual([]);
    expect(project(doc)?.budget).toBe(600);
    expect(milestone(doc, "m1")?.budget).toBe(0);
    expect(project(doc)?.scope?.progress).toStrictEqual(
      percentageProgress(100),
    );
    expect(milestone(doc, "m1")?.scope?.progress).toStrictEqual(
      percentageProgress(0),
    );
  });

  it("renames milestones/roadmaps without disturbing membership or budgets", () => {
    const doc = apply(
      costedScope(),
      editMilestone({
        id: "m1",
        roadmapId: "r1",
        title: "Alpha (renamed)",
        deliveryTarget: "2026-10-01",
      }),
      editRoadmap({ id: "r1", title: "2026 H2 (revised)" }),
      updateProject({ id: "p1", title: "Platform v2", budgetType: "OPEX" }),
    );

    expect(errors(doc)).toStrictEqual([]);
    expect(milestone(doc, "m1")).toMatchObject({
      title: "Alpha (renamed)",
      deliveryTarget: "2026-10-01",
      budget: 1200,
    });
    expect(milestone(doc, "m1")?.scope?.deliverables).toStrictEqual(["api"]);
    expect(state(doc).roadmaps[0].title).toBe("2026 H2 (revised)");
    expect(project(doc)).toMatchObject({
      title: "Platform v2",
      budgetType: "OPEX",
      budget: 1800,
    });
  });

  it("removing a whole project deletes its deliverables and zeroes the milestones' budgets", () => {
    const doc = apply(costedScope(), removeProject({ projectId: "p1" }));

    expect(errors(doc)).toStrictEqual([]);
    expect(state(doc).projects).toStrictEqual([]);
    expect(state(doc).deliverables).toStrictEqual([]);
    expect(milestone(doc, "m1")?.budget).toBe(0);
    expect(milestone(doc, "m2")?.budget).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * KNOWN GAPS — each `it.fails` states the desired behaviour. See the report.
 * ────────────────────────────────────────────────────────────────────────── */
describe("former gaps (fixed — kept as regression tests)", () => {
  describe("GAP 1: budget ↔ margin round-trip uses inconsistent units", () => {
    it("a total budget set on the project survives the next re-derivation", () => {
      // cost 1500; asking for a 3000 budget should mean a 100% margin
      let doc = apply(
        costedScope(),
        setProjectTotalBudget({ projectId: "p1", totalBudget: 3000 }),
      );
      expect(project(doc)?.budget).toBe(3000);
      // any anchor change re-derives budget from the anchors' margins...
      doc = apply(
        doc,
        setDeliverableBudgetAnchorProject({
          deliverableId: "api",
          quantity: 10,
        }),
      );
      // ...and it should still be 3000. Today margin was stored as the ratio 2 (not 100%),
      // and 1500 × (1 + 2/100) = 1530.
      expect(project(doc)?.budget).toBe(3000);
    });

    it("setting a budget on an uncosted project does not produce an infinite margin", () => {
      const doc = apply(
        plannedScope(),
        setProjectTotalBudget({ projectId: "p1", totalBudget: 100 }),
      );
      expect(errors(doc)).toStrictEqual([]);
      expect(project(doc)).toMatchObject({ budget: 100, targetBudget: 100 });
      expect(Number.isFinite(anchor(doc, "api")?.margin)).toBe(true);
    });
  });

  describe("GAP 2: container-level changes leave other containers stale", () => {
    it("linking a costed deliverable into a project re-derives that project's budget", () => {
      const doc = apply(
        costedScope(),
        removeProjectDeliverable({ projectId: "p1", deliverableId: "ui" }),
        addProject({ id: "p2", code: "P2", title: "Second" }),
        addDeliverableInSet({ deliverableId: "ui", projectId: "p2" }),
      );
      expect(anchor(doc, "ui")?.project).toBe("p2");
      expect(project(doc, "p2")?.budget).toBe(600); // today: 0 — only the progress invariant runs
    });

    it("removing a milestone does not leave its deleted deliverables dangling in the project", () => {
      const doc = apply(
        costedScope(),
        setDeliverableProgress({
          id: "api",
          workProgress: { percentage: 100 },
        }),
        removeMilestone({ id: "m1", roadmapId: "r1" }),
      );
      expect(deliverable(doc, "api")).toBeUndefined(); // it IS deleted...
      expect(project(doc)?.scope?.deliverables).toStrictEqual(["ui"]); // ...but the project still lists it
      expect(project(doc)?.scope?.progress).toStrictEqual(
        percentageProgress(0),
      ); // and its progress is stale
    });

    it("removing a roadmap re-derives the budgets of projects that shared its deliverables", () => {
      const doc = apply(costedScope(), removeRoadmap({ id: "r1" }));
      expect(state(doc).deliverables).toStrictEqual([]); // deleted with the milestones
      expect(project(doc)?.scope?.deliverables).toStrictEqual([]); // today: still ["api","ui"]
      expect(project(doc)?.budget).toBe(0); // today: still 1800 — no invariant runs at all
    });

    it("removing a project re-derives the progress of milestones that shared its deliverables", () => {
      const doc = apply(
        costedScope(),
        setDeliverableProgress({
          id: "api",
          workProgress: { percentage: 100 },
        }),
        removeProject({ projectId: "p1" }),
      );
      expect(milestone(doc, "m1")?.scope?.deliverables).toStrictEqual([]); // today: still ["api"]
      expect(milestone(doc, "m1")?.scope?.progress).toStrictEqual(
        percentageProgress(0),
      ); // today: 100
    });

    it("deleting a deliverable scheduled in two milestones unlinks it from both", () => {
      const doc = apply(
        plannedScope(),
        addDeliverableInSet({ deliverableId: "api", milestoneId: "m2" }),
        removeDeliverable({ id: "api" }),
      );
      expect(milestone(doc, "m1")?.scope?.deliverables).toStrictEqual([]);
      expect(milestone(doc, "m2")?.scope?.deliverables).toStrictEqual(["ui"]); // api is gone from both; ui was always m2's own
    });
  });

  describe("GAP 3: missing validation", () => {
    it("duplicate ids are rejected (only agents check today)", () => {
      const doc = apply(
        plannedScope(),
        addProject({ id: "p1", code: "DUP", title: "Duplicate" }),
        addRoadmap({ id: "r1", title: "Duplicate" }),
        addMilestone({ id: "m1", roadmapId: "r1" }),
        addProjectDeliverable({
          projectId: "p1",
          deliverableId: "api",
          title: "Duplicate",
        }),
      );
      expect(errors(doc)).toHaveLength(4);
      expect(state(doc).projects).toHaveLength(1);
    });

    it("linking an unknown deliverable id into a set is rejected", () => {
      const doc = apply(
        plannedScope(),
        addDeliverableInSet({ deliverableId: "ghost", milestoneId: "m1" }),
      );
      expect(lastError(doc)).toBeDefined();
      expect(milestone(doc, "m1")?.scope?.deliverables).not.toContain("ghost");
    });

    it("story points cannot be over-completed", () => {
      const doc = apply(
        plannedScope(),
        setDeliverableProgress({
          id: "api",
          workProgress: { storyPoints: { total: 5, completed: 8 } },
        }),
      );
      expect(lastError(doc)).toBeDefined(); // today: accepted, milestone reads 160%
    });

    it("negative costs and quantities are rejected", () => {
      const doc = apply(
        plannedScope(),
        setDeliverableBudgetAnchorProject({
          deliverableId: "api",
          unitCost: -100,
          quantity: -1,
        }),
      );
      expect(lastError(doc)).toBeDefined();
    });

    it("removing an unknown project is an error like every other remove", () => {
      const doc = apply(plannedScope(), removeProject({ projectId: "nope" }));
      expect(lastError(doc)).toBe("Project not found");
    });
  });

  describe("GAP 4: referential integrity of contributors", () => {
    it("removing an agent clears (or refuses while) it is an owner or coordinator", () => {
      const doc = apply(plannedScope(), removeAgent({ id: "alice" }));
      const stillReferenced =
        deliverable(doc, "api")?.owner === "alice" ||
        milestone(doc, "m1")?.coordinators.includes("alice");
      expect(lastError(doc) !== undefined || !stillReferenced).toBe(true);
    });
  });

  describe("GAP 5: status and edit semantics", () => {
    it("recording progress on a canceled deliverable does not silently reopen it", () => {
      const doc = apply(
        plannedScope(),
        editDeliverable({ id: "api", status: "CANCELED" }),
        setDeliverableProgress({ id: "api", workProgress: { percentage: 10 } }),
      );
      expect(deliverable(doc, "api")?.status).toBe("CANCELED"); // today: IN_PROGRESS
    });

    it("an explicit empty string clears roadmap/milestone text fields", () => {
      const doc = apply(
        plannedScope(),
        editRoadmap({ id: "r1", description: "to be cleared" }),
        editRoadmap({ id: "r1", description: "" }),
        editMilestone({ id: "m1", roadmapId: "r1", sequenceCode: "" }),
      );
      expect(state(doc).roadmaps[0].description).toBe(""); // today: "to be cleared" (|| fallback)
      expect(milestone(doc, "m1")?.sequenceCode).toBe(""); // today: "M1"
    });

    it("updating a project with explicit nulls keeps non-null fields valid", () => {
      const doc = apply(
        plannedScope(),
        updateProject({ id: "p1", slug: null, code: null }),
      );
      expect(typeof project(doc)?.slug).toBe("string"); // today: null (Object.assign)
      expect(typeof project(doc)?.code).toBe("string");
    });

    it("the budget anchor only carries its schema fields", () => {
      const doc = costedScope();
      expect(Object.keys(anchor(doc, "api") ?? {}).sort()).toStrictEqual(
        ["margin", "marginPinned", "project", "quantity", "unit", "unitCost"], // today also: deliverableId (leaked from the input)
      );
    });
  });
});
