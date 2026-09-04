/**
 * Validation, cascades and edit semantics added when the reducer gaps were
 * closed: duplicate ids, referential integrity of sets and agents, progress
 * and money bounds, and "explicit null keeps / empty string clears" edits.
 */
import {
  addAgent,
  addCoordinator,
  addDeliverable,
  addDeliverableInSet,
  addKeyResult,
  addMilestone,
  addMilestoneDeliverable,
  addProject,
  addProjectDeliverable,
  addRoadmap,
  editDeliverable,
  editKeyResult,
  editMilestone,
  editRoadmap,
  removeAgent,
  removeDeliverable,
  setDeliverableBudgetAnchorProject,
  setDeliverableProgress,
  setProjectMargin,
  setProjectTotalBudget,
  updateProject,
  updateProjectOwner,
  utils,
  removeProjectDeliverable,
  setProjectExpenditure,
} from "document-models/scope-of-work/v1";
import { describe, expect, it } from "vitest";
import {
  binaryProgress,
  percentageProgress,
} from "../src/reducers/progress.js";
import {
  apply,
  craft,
  errors,
  lastError,
  rawDeliverable,
  rawMilestone,
  rawProject,
  rawRoadmap,
  state,
  type Doc,
} from "./reducer-test-helpers.js";
import { round2 } from "../src/reducers/util.js";

const deliverable = (doc: Doc, id: string) =>
  state(doc).deliverables.find((d) => d.id === id);
const project = (doc: Doc, id = "p1") =>
  state(doc).projects.find((p) => p.id === id);
const milestone = (doc: Doc, id: string) =>
  state(doc)
    .roadmaps.flatMap((r) => r.milestones)
    .find((m) => m.id === id);

/** roadmap r1 / milestone m1, project p1, standalone deliverable d1, agent alice */
const base = () =>
  apply(
    utils.createDocument(),
    addAgent({ id: "alice", name: "Alice" }),
    addRoadmap({ id: "r1", title: "R" }),
    addMilestone({
      id: "m1",
      roadmapId: "r1",
      title: "M",
      sequenceCode: "M1",
      description: "d",
      deliveryTarget: "2026",
    }),
    addProject({
      id: "p1",
      code: "P1",
      title: "P",
      slug: "p",
      abstract: "a",
      imageUrl: "https://img.example/p.png",
    }),
    addDeliverable({ id: "d1", title: "D" }),
  );

describe("duplicate ids are rejected", () => {
  it("for every ADD_* operation, leaving state untouched", () => {
    const doc = apply(
      base(),
      addProjectDeliverable({
        projectId: "p1",
        deliverableId: "pd",
        title: "x",
      }),
      addMilestoneDeliverable({
        milestoneId: "m1",
        deliverableId: "md",
        title: "x",
      }),
      addKeyResult({ id: "kr", deliverableId: "d1", title: "x" }),
      // duplicates ↓
      addAgent({ id: "alice", name: "Impostor" }),
      addRoadmap({ id: "r1", title: "dup" }),
      addMilestone({ id: "m1", roadmapId: "r1" }),
      addProject({ id: "p1", code: "dup", title: "dup" }),
      addDeliverable({ id: "d1" }),
      addProjectDeliverable({
        projectId: "p1",
        deliverableId: "d1",
        title: "dup",
      }),
      addMilestoneDeliverable({
        milestoneId: "m1",
        deliverableId: "pd",
        title: "dup",
      }),
      addKeyResult({ id: "kr", deliverableId: "d1", title: "dup" }),
    );

    expect(errors(doc)).toStrictEqual([
      "Agent with ID alice already exists",
      "Roadmap with ID r1 already exists",
      "Milestone with ID m1 already exists",
      "Project with ID p1 already exists",
      "Deliverable with ID d1 already exists",
      "Deliverable with ID d1 already exists",
      "Deliverable with ID pd already exists",
      "Key result with ID kr already exists",
    ]);
    expect(state(doc).contributors).toHaveLength(1);
    expect(state(doc).roadmaps).toHaveLength(1);
    expect(milestone(doc, "m1")?.title).toBe("M");
    expect(state(doc).projects).toHaveLength(1);
    expect(state(doc).deliverables.map((d) => d.id)).toStrictEqual([
      "d1",
      "pd",
      "md",
    ]);
    expect(deliverable(doc, "d1")?.keyResults).toHaveLength(1);
  });
});

describe("sets only accept deliverables that exist", () => {
  it("rejects an unknown id on both the milestone and the project path", () => {
    const doc = apply(
      base(),
      addDeliverableInSet({ deliverableId: "ghost", milestoneId: "m1" }),
      addDeliverableInSet({ deliverableId: "ghost", projectId: "p1" }),
      addDeliverableInSet({ deliverableId: "d1", milestoneId: "m1" }),
    );

    expect(errors(doc)).toStrictEqual([
      "Deliverable ghost not found",
      "Deliverable ghost not found",
    ]);
    expect(milestone(doc, "m1")?.scope?.deliverables).toStrictEqual(["d1"]);
    expect(project(doc)?.scope?.deliverables).toStrictEqual([]);
  });
});

describe("progress bounds", () => {
  it("accepts the percentage boundaries and rejects values outside 0-100", () => {
    const doc = apply(
      base(),
      setDeliverableProgress({ id: "d1", workProgress: { percentage: 0 } }),
      setDeliverableProgress({ id: "d1", workProgress: { percentage: -1 } }),
      setDeliverableProgress({ id: "d1", workProgress: { percentage: 101 } }),
    );

    expect(errors(doc)).toStrictEqual([
      "Percentage must be between 0 and 100",
      "Percentage must be between 0 and 100",
    ]);
    expect(deliverable(doc, "d1")).toMatchObject({
      status: "IN_PROGRESS",
      workProgress: percentageProgress(0),
    });
  });

  it("rejects negative or over-completed story points", () => {
    const doc = apply(
      base(),
      setDeliverableProgress({
        id: "d1",
        workProgress: { storyPoints: { total: -1, completed: 0 } },
      }),
      setDeliverableProgress({
        id: "d1",
        workProgress: { storyPoints: { total: 5, completed: -1 } },
      }),
      setDeliverableProgress({
        id: "d1",
        workProgress: { storyPoints: { total: 5, completed: 6 } },
      }),
    );

    expect(errors(doc)).toHaveLength(3);
    expect(new Set(errors(doc)).size).toBe(1);
    expect(deliverable(doc, "d1")?.workProgress).toBeNull();
  });

  it("refuses to record progress on a CANCELED or WONT_DO deliverable", () => {
    const doc = apply(
      base(),
      addDeliverable({ id: "d2", status: "WONT_DO" }),
      editDeliverable({ id: "d1", status: "CANCELED" }),
      setDeliverableProgress({ id: "d1", workProgress: { percentage: 10 } }),
      setDeliverableProgress({ id: "d2", workProgress: { done: true } }),
    );

    expect(errors(doc)).toStrictEqual([
      "Deliverable d1 is closed",
      "Deliverable d2 is closed",
    ]);
    expect(deliverable(doc, "d1")).toMatchObject({
      status: "CANCELED",
      workProgress: null,
    });
    expect(deliverable(doc, "d2")).toMatchObject({
      status: "WONT_DO",
      workProgress: null,
    });
  });
});

describe("money bounds", () => {
  it("rejects negative unit cost, quantity or margin on an anchor", () => {
    const doc = apply(
      base(),
      setDeliverableBudgetAnchorProject({ deliverableId: "d1", unitCost: -1 }),
      setDeliverableBudgetAnchorProject({ deliverableId: "d1", quantity: -1 }),
      setDeliverableBudgetAnchorProject({ deliverableId: "d1", margin: -1 }),
    );

    expect(errors(doc)).toHaveLength(3);
    expect(deliverable(doc, "d1")?.budgetAnchor).toMatchObject({
      unitCost: 0,
      quantity: 0,
      margin: 0,
    });
  });

  it("builds a complete anchor from defaults when the deliverable had none, and null clears the project", () => {
    const doc = craft({
      deliverables: [rawDeliverable({ id: "d1", budgetAnchor: null })],
    });

    const next = apply(
      doc,
      setDeliverableBudgetAnchorProject({ deliverableId: "d1", unitCost: 5 }),
      setDeliverableBudgetAnchorProject({
        deliverableId: "d1",
        project: "p9",
        unit: "StoryPoints",
        quantity: 2,
        margin: 10,
      }),
      setDeliverableBudgetAnchorProject({ deliverableId: "d1", project: null }),
    );

    expect(errors(next)).toStrictEqual([]);
    expect(deliverable(next, "d1")?.budgetAnchor).toStrictEqual({
      project: null,
      unit: "StoryPoints",
      unitCost: 5,
      quantity: 2,
      margin: 10,
      marginPinned: true,
    });
  });

  it("rejects a negative project margin", () => {
    const doc = apply(
      base(),
      addProjectDeliverable({
        projectId: "p1",
        deliverableId: "pd",
        title: "x",
      }),
      setProjectMargin({ projectId: "p1", margin: -5 }),
    );

    expect(lastError(doc)).toBe("Margin must be zero or positive");
  });

  it("rejects a negative total budget; a budget below cost is allowed and reads as a negative derived margin", () => {
    const doc = apply(
      base(),
      addProjectDeliverable({
        projectId: "p1",
        deliverableId: "pd",
        title: "x",
      }),
      setDeliverableBudgetAnchorProject({
        deliverableId: "pd",
        unitCost: 100,
        quantity: 3,
      }),
      setProjectTotalBudget({ projectId: "p1", totalBudget: -1 }),
      setProjectTotalBudget({ projectId: "p1", totalBudget: 299 }),
    );

    expect(errors(doc)).toStrictEqual([
      "Total budget must be zero or positive",
    ]);
    expect(project(doc)).toMatchObject({ budget: 299, targetBudget: 299 });
    expect(deliverable(doc, "pd")?.budgetAnchor).toMatchObject({
      margin: -0.33,
      marginPinned: false,
    });
  });

  it("allows a zero budget on a project with no cost, including one without a scope", () => {
    const doc = craft({
      projects: [rawProject({ id: "p-noscope", scope: null })],
    });

    const next = apply(
      base(),
      addProjectDeliverable({
        projectId: "p1",
        deliverableId: "pd",
        title: "x",
      }),
      setProjectTotalBudget({ projectId: "p1", totalBudget: 0 }),
    );
    expect(errors(next)).toStrictEqual([]);
    expect(project(next)?.budget).toBe(0);

    const noScope = apply(
      doc,
      setProjectTotalBudget({ projectId: "p-noscope", totalBudget: 0 }),
    );
    expect(errors(noScope)).toStrictEqual([]);
  });
});

describe("cascades", () => {
  it("removing an agent clears every owner and coordinator reference to it", () => {
    const doc = apply(
      base(),
      addAgent({ id: "bob", name: "Bob" }),
      addProjectDeliverable({
        projectId: "p1",
        deliverableId: "pd",
        title: "x",
      }),
      editDeliverable({ id: "d1", owner: "alice" }),
      editDeliverable({ id: "pd", owner: "bob" }),
      updateProjectOwner({ id: "p1", projectOwner: "alice" }),
      addCoordinator({ id: "alice", milestoneId: "m1" }),
      addCoordinator({ id: "bob", milestoneId: "m1" }),
      removeAgent({ id: "alice" }),
    );

    expect(errors(doc)).toStrictEqual([]);
    expect(deliverable(doc, "d1")?.owner).toBeNull();
    expect(deliverable(doc, "pd")?.owner).toBe("bob");
    expect(project(doc)?.projectOwner).toBeNull();
    expect(milestone(doc, "m1")?.coordinators).toStrictEqual(["bob"]);
  });

  it("deleting a deliverable skips containers that have no scope", () => {
    const doc = craft({
      deliverables: [rawDeliverable({ id: "d1" })],
      projects: [rawProject({ id: "p-noscope", scope: null })],
      roadmaps: [
        rawRoadmap({
          id: "r1",
          milestones: [rawMilestone({ id: "m-noscope", scope: null })],
        }),
      ],
    });

    const next = apply(doc, removeDeliverable({ id: "d1" }));

    expect(errors(next)).toStrictEqual([]);
    expect(state(next).deliverables).toStrictEqual([]);
  });
});

describe("edit semantics: explicit null keeps, empty string clears", () => {
  it("updateProject sets every field, ignores null on required fields, accepts null on optional ones", () => {
    const doc = apply(
      base(),
      updateProject({
        id: "p1",
        title: "T2",
        code: "C2",
        slug: "s2",
        abstract: "A2",
        imageUrl: "https://img.example/2.png",
        budgetType: "OPEX",
        currency: "EUR",
        budget: 12,
      }),
      updateProject({ id: "p1" }),
      updateProject({
        id: "p1",
        title: null,
        code: null,
        slug: null,
        abstract: null,
        imageUrl: null,
        budgetType: null,
        currency: null,
        budget: null,
      }),
    );

    expect(errors(doc)).toStrictEqual([]);
    expect(project(doc)).toMatchObject({
      title: "T2",
      code: "C2",
      slug: "s2",
      abstract: null,
      imageUrl: null,
      budgetType: null,
      currency: null,
      budget: 0,
      targetBudget: null,
    });
  });

  it("editMilestone and editRoadmap clear text with an empty string but keep it on null", () => {
    const doc = apply(
      base(),
      editMilestone({
        id: "m1",
        roadmapId: "r1",
        title: "",
        sequenceCode: "",
        description: "",
        deliveryTarget: "",
      }),
      editRoadmap({ id: "r1", title: "", slug: "", description: "" }),
      editMilestone({
        id: "m1",
        roadmapId: "r1",
        title: null,
        sequenceCode: null,
        description: null,
        deliveryTarget: null,
      }),
      editRoadmap({ id: "r1", title: null, slug: null, description: null }),
    );

    expect(errors(doc)).toStrictEqual([]);
    expect(milestone(doc, "m1")).toMatchObject({
      title: "",
      sequenceCode: "",
      description: "",
      deliveryTarget: "",
    });
    expect(state(doc).roadmaps[0]).toMatchObject({
      title: "",
      slug: "",
      description: "",
    });
  });

  it("editKeyResult clears with an empty string and keeps on null", () => {
    const doc = apply(
      base(),
      addKeyResult({
        id: "kr",
        deliverableId: "d1",
        title: "Launch",
        link: "https://a.example",
      }),
      editKeyResult({ id: "kr", deliverableId: "d1", title: "" }),
      editKeyResult({ id: "kr", deliverableId: "d1", title: null, link: null }),
    );

    expect(errors(doc)).toStrictEqual([]);
    expect(deliverable(doc, "d1")?.keyResults).toStrictEqual([
      { id: "kr", title: "", link: "https://a.example" },
    ]);
  });

  it("binary progress still completes a deliverable", () => {
    const doc = apply(
      base(),
      setDeliverableProgress({ id: "d1", workProgress: { done: true } }),
    );
    expect(deliverable(doc, "d1")).toMatchObject({
      status: "DELIVERED",
      workProgress: binaryProgress(true),
    });
  });
});

describe("fixed budgets and pinned margins", () => {
  const quoted = (
    id: string,
    unitCost: number,
    quantity: number,
    margin?: number,
  ) =>
    setDeliverableBudgetAnchorProject(
      margin === undefined
        ? { deliverableId: id, unitCost, quantity }
        : { deliverableId: id, unitCost, quantity, margin },
    );
  const funded = (...ids: string[]) =>
    ids.map((id) =>
      addProjectDeliverable({ projectId: "p1", deliverableId: id, title: id }),
    );

  it("a budget set on the project fixes the envelope; every new quote is fitted into it", () => {
    let doc = apply(
      base(),
      updateProject({ id: "p1", budget: 1000 }),
      ...funded("a"),
      quoted("a", 100, 5),
    );
    expect(project(doc)).toMatchObject({ budget: 1000, targetBudget: 1000 });
    expect(deliverable(doc, "a")?.budgetAnchor).toMatchObject({
      margin: 100,
      marginPinned: false,
    }); // 500 of cost → 1000

    doc = apply(doc, ...funded("b"), quoted("b", 100, 5));
    expect(project(doc)?.budget).toBe(1000);
    expect(
      [deliverable(doc, "a"), deliverable(doc, "b")].map(
        (d) => d?.budgetAnchor?.margin,
      ),
    ).toStrictEqual([0, 0]); // 1000 of cost

    doc = apply(doc, ...funded("c"), quoted("c", 100, 5));
    expect(project(doc)?.budget).toBe(1000); // the envelope never moves…
    expect(deliverable(doc, "c")?.budgetAnchor?.margin).toBe(-33.33); // …the margin goes negative: over budget
    expect(errors(doc)).toStrictEqual([]);
  });

  it("pinned margins hold, unpinned quotes absorb the envelope, and a line can be released or pinned again", () => {
    let doc = apply(
      base(),
      ...funded("a", "b"),
      quoted("a", 100, 5, 20),
      quoted("b", 100, 2),
      setProjectTotalBudget({ projectId: "p1", totalBudget: 1000 }),
    );
    expect(deliverable(doc, "a")?.budgetAnchor).toMatchObject({
      margin: 20,
      marginPinned: true,
    }); // typed → pinned → 600
    expect(deliverable(doc, "b")?.budgetAnchor).toMatchObject({
      margin: 100,
      marginPinned: false,
    }); // (1000 − 600) / 200 − 1
    doc = apply(
      doc,
      setDeliverableBudgetAnchorProject({
        deliverableId: "a",
        marginPinned: false,
      }),
    );
    expect(
      [deliverable(doc, "a"), deliverable(doc, "b")].map(
        (d) => d?.budgetAnchor?.margin,
      ),
    ).toStrictEqual([42.86, 42.86]); // 1000 / 700 − 1
    doc = apply(
      doc,
      setDeliverableBudgetAnchorProject({
        deliverableId: "b",
        marginPinned: true,
      }),
    );
    expect(deliverable(doc, "b")?.budgetAnchor).toMatchObject({
      margin: 42.86,
      marginPinned: true,
    });
  });

  it("with every margin pinned there is nothing to solve: the envelope stands and the lines keep their own totals", () => {
    const doc = apply(
      base(),
      ...funded("a", "b"),
      quoted("a", 100, 5, 20),
      quoted("b", 100, 2, 10),
      setProjectTotalBudget({ projectId: "p1", totalBudget: 1000 }),
    );
    expect(project(doc)).toMatchObject({ budget: 1000, targetBudget: 1000 });
    expect(
      [deliverable(doc, "a"), deliverable(doc, "b")].map(
        (d) => d?.budgetAnchor?.margin,
      ),
    ).toStrictEqual([20, 10]);
  });

  it("setProjectMargin pins every line; releasing the budget returns to a derived total", () => {
    let doc = apply(
      base(),
      ...funded("a", "b"),
      quoted("a", 100, 5),
      quoted("b", 100, 2),
      setProjectMargin({ projectId: "p1", margin: 10 }),
      setProjectTotalBudget({ projectId: "p1", totalBudget: 5000 }),
    );
    expect(
      [deliverable(doc, "a"), deliverable(doc, "b")].map(
        (d) => d?.budgetAnchor,
      ),
    ).toMatchObject([
      { margin: 10, marginPinned: true },
      { margin: 10, marginPinned: true },
    ]);
    expect(project(doc)?.budget).toBe(5000); // nothing free to absorb it
    doc = apply(doc, updateProject({ id: "p1", budget: null }));
    expect(project(doc)).toMatchObject({ budget: 770, targetBudget: null }); // 550 + 220
  });

  it("a detached anchor keeps its pin, and an anchor without the flag reads as unpinned", () => {
    const doc = craft({
      projects: [
        rawProject({
          id: "p1",
          scope: {
            deliverables: ["d1"],
            status: "DRAFT",
            progress: percentageProgress(0),
            deliverablesCompleted: { total: 1, completed: 0 },
          },
        }),
      ],
      deliverables: [
        rawDeliverable({
          id: "d1",
          budgetAnchor: {
            project: "p1",
            unit: "Hours",
            unitCost: 10,
            quantity: 1,
            margin: 5,
            marginPinned: null,
          },
        }),
      ],
    });
    const next = apply(
      doc,
      removeProjectDeliverable({ projectId: "p1", deliverableId: "d1" }),
    );
    expect(deliverable(next, "d1")?.budgetAnchor).toMatchObject({
      project: "",
      margin: 5,
      marginPinned: false,
    });
  });

  it("rejects a negative budget on create and update", () => {
    const doc = apply(
      base(),
      addProject({ id: "p2", code: "P2", title: "neg", budget: -1 }),
      updateProject({ id: "p1", budget: -5 }),
    );
    expect(errors(doc)).toStrictEqual([
      "Budget must be zero or positive",
      "Budget must be zero or positive",
    ]);
    expect(state(doc).projects.map((p) => p.id)).toStrictEqual(["p1"]);
  });

  it("stores every number with at most two decimals", () => {
    const doc = apply(
      base(),
      ...funded("a"),
      quoted("a", 12.345, 1.005, 33.333),
      setDeliverableProgress({ id: "a", workProgress: { percentage: 33.333 } }),
      updateProject({ id: "p1", budget: 100.005 }),
    );
    expect(deliverable(doc, "a")?.budgetAnchor).toMatchObject({
      unitCost: 12.35,
      quantity: 1.01,
      margin: 33.33,
    });
    expect(deliverable(doc, "a")?.workProgress?.value).toBe(33.33);
    expect(project(doc)).toMatchObject({
      targetBudget: 100.01,
      budget: 100.01,
    });
  });
});

describe("round2", () => {
  it("rounds half-cents up, tolerates exponent notation and passes non-finite values through", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(12.345)).toBe(12.35);
    expect(round2(38.888888888888886)).toBe(38.89);
    expect(round2(1e-7)).toBe(0);
    expect(round2(1.5e-7)).toBe(0);
    expect(round2(Infinity)).toBe(Infinity);
    expect(Number.isNaN(round2(Number.NaN))).toBe(true);
  });

  it("a legacy anchor without the pin flag stays unpinned when re-quoted without a margin", () => {
    const doc = craft({
      deliverables: [
        rawDeliverable({
          id: "d1",
          budgetAnchor: {
            project: "",
            unit: "Hours",
            unitCost: 1,
            quantity: 1,
            margin: 0,
            marginPinned: null,
          },
        }),
      ],
    });
    const next = apply(
      doc,
      setDeliverableBudgetAnchorProject({ deliverableId: "d1", unitCost: 3 }),
    );
    expect(deliverable(next, "d1")?.budgetAnchor).toMatchObject({
      unitCost: 3,
      marginPinned: false,
    });
  });
});

describe("expenditure", () => {
  it("records actuals and cap with two decimals and derives the percentage against the cap", () => {
    const doc = apply(
      base(),
      setProjectExpenditure({ projectId: "p1", actuals: 250.555, cap: 1000 }),
    );
    expect(errors(doc)).toStrictEqual([]);
    expect(project(doc)?.expenditure).toStrictEqual({
      actuals: 250.56,
      cap: 1000,
      percentage: 25.06,
    });
  });

  it("without a cap the percentage reads against the budget and follows it", () => {
    let doc = apply(
      base(),
      addProjectDeliverable({
        projectId: "p1",
        deliverableId: "a",
        title: "a",
      }),
      setDeliverableBudgetAnchorProject({
        deliverableId: "a",
        unitCost: 100,
        quantity: 4,
      }), // budget 400
      setProjectExpenditure({ projectId: "p1", actuals: 100 }),
    );
    expect(project(doc)?.expenditure).toStrictEqual({
      actuals: 100,
      cap: 0,
      percentage: 25,
    });
    doc = apply(doc, updateProject({ id: "p1", budget: 800 })); // a fixed envelope doubles the base
    expect(project(doc)?.expenditure?.percentage).toBe(12.5);
    doc = apply(doc, setProjectExpenditure({ projectId: "p1", cap: 50 })); // a cap wins once set, even when exceeded
    expect(project(doc)?.expenditure).toStrictEqual({
      actuals: 100,
      cap: 50,
      percentage: 200,
    });
  });

  it("stays at 0% when neither a cap nor a budget exists, and rejects negative values", () => {
    const doc = apply(
      base(),
      setProjectExpenditure({ projectId: "p1", actuals: 10 }),
      setProjectExpenditure({ projectId: "p1", actuals: -1 }),
      setProjectExpenditure({ projectId: "p1", cap: -1 }),
      setProjectExpenditure({ projectId: "nope", actuals: 1 }),
    );
    expect(project(doc)?.expenditure).toStrictEqual({
      actuals: 10,
      cap: 0,
      percentage: 0,
    });
    expect(errors(doc)).toStrictEqual([
      "Actuals and cap must be zero or positive",
      "Actuals and cap must be zero or positive",
      "Project not found",
    ]);
  });

  it("a project without an expenditure record gets one on first use", () => {
    const doc = craft({
      projects: [rawProject({ id: "p1", expenditure: null })],
    });
    const next = apply(
      doc,
      setProjectExpenditure({ projectId: "p1", cap: 300 }),
    );
    expect(project(next)?.expenditure).toStrictEqual({
      actuals: 0,
      cap: 300,
      percentage: 0,
    });
  });
});
