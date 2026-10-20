import {
  addDeliverable,
  addMilestone,
  addProject,
  addProjectDeliverable,
  editDeliverable,
  editDeliverablesSet,
  removeProject,
  removeProjectDeliverable,
  setDeliverableBudgetAnchorProject,
  setProjectMargin,
  setProjectTotalBudget,
  updateProject,
  updateProjectOwner,
  utils,
  linkProjectWbs,
  addProjectKnowledgeRef,
  removeProjectKnowledgeRef,
  setProjectReferences,
} from "document-models/scope-of-work/v1";
import { describe, expect, it } from "vitest";
import type { Deliverable } from "../gen/schema/types.js";
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
import {
  binaryProgress,
  percentageProgress,
  storyPointsProgress,
} from "../src/reducers/progress.js";

type Doc = ReturnType<typeof utils.createDocument>;

const project = (doc: Doc, id = "p1") =>
  state(doc).projects.find((p) => p.id === id);
const anchorOf = (doc: Doc, id: string) =>
  state(doc).deliverables.find((d) => d.id === id)?.budgetAnchor;

/** Project p1 with two costed deliverables: 100*2 = 200 and 50*2 = 100 (total cost 300). */
const costed = () =>
  apply(
    utils.createDocument(),
    addProject({ id: "p1", code: "P1", title: "Project" }),
    addProjectDeliverable({
      projectId: "p1",
      deliverableId: "d1",
      title: "One",
    }),
    addProjectDeliverable({
      projectId: "p1",
      deliverableId: "d2",
      title: "Two",
    }),
    setDeliverableBudgetAnchorProject({
      deliverableId: "d1",
      unitCost: 100,
      quantity: 2,
    }),
    setDeliverableBudgetAnchorProject({
      deliverableId: "d2",
      unitCost: 50,
      quantity: 2,
    }),
  );

/** A document whose project p1 scope lists the given deliverables verbatim. */
const withScopedDeliverables = (
  deliverables: Deliverable[],
  extraIds: string[] = [],
) => {
  const doc = craft({
    deliverables: [...deliverables],
    projects: [
      rawProject({
        id: "p1",
        scope: {
          deliverables: [...deliverables.map((d) => d.id), ...extraIds],
          status: "DRAFT",
          progress: percentageProgress(0),
          deliverablesCompleted: { total: 0, completed: 0 },
        },
      }),
    ],
  });
  return doc;
};

describe("projects reducer", () => {
  describe("addProject", () => {
    it("stores all provided fields", () => {
      const doc = apply(
        utils.createDocument(),
        addProject({
          id: "p1",
          code: "P1",
          title: "Full",
          slug: "full",
          projectOwner: "alice",
          abstract: "An abstract",
          imageUrl: "https://example.com/img.png",
          budgetType: "OPEX",
          currency: "EUR",
          budget: 1000,
        }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(project(doc)).toStrictEqual({
        id: "p1",
        code: "P1",
        title: "Full",
        slug: "full",
        projectOwner: "alice",
        abstract: "An abstract",
        imageUrl: "https://example.com/img.png",
        budgetType: "OPEX",
        currency: "EUR",
        budget: 1000,
        wbsRef: null,
        knowledgeRefs: [],
        references: [],
        targetBudget: 1000, // a budget given at creation fixes the envelope
        expenditure: { percentage: 0, actuals: 0, cap: 0 },
        scope: {
          deliverables: [],
          status: "DRAFT",
          progress: percentageProgress(0),
          deliverablesCompleted: { total: 0, completed: 0 },
        },
      });
    });

    it("applies defaults for omitted fields", () => {
      const doc = apply(
        utils.createDocument(),
        addProject({ id: "p1", code: "P1", title: "Min" }),
      );

      expect(project(doc)).toMatchObject({
        slug: "",
        projectOwner: null,
        abstract: null,
        imageUrl: null,
        budgetType: "CAPEX",
        currency: "USD",
        budget: 0,
      });
    });
  });

  describe("updateProject / updateProjectOwner", () => {
    it("updates fields and the owner", () => {
      const doc = apply(
        utils.createDocument(),
        addProject({ id: "p1", code: "P1", title: "Old" }),
        updateProject({
          id: "p1",
          title: "New",
          code: "P1b",
          budgetType: "OVERHEAD",
        }),
        updateProjectOwner({ id: "p1", projectOwner: "bob" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(project(doc)).toMatchObject({
        title: "New",
        code: "P1b",
        budgetType: "OVERHEAD",
        projectOwner: "bob",
      });
    });

    it("records errors for an unknown project", () => {
      const doc = apply(
        utils.createDocument(),
        updateProject({ id: "nope", title: "x" }),
        updateProjectOwner({ id: "nope", projectOwner: "bob" }),
      );

      expect(errorAt(doc, 0)).toBe("Project not found");
      expect(errorAt(doc, 1)).toBe("Project not found");
    });
  });

  describe("removeProject", () => {
    it("removes the project and the deliverables in its scope", () => {
      const doc = apply(
        costed(),
        addDeliverable({ id: "d-free" }),
        addProject({ id: "p2", code: "P2", title: "Other" }),
        removeProject({ projectId: "p1" }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(state(doc).projects.map((p) => p.id)).toStrictEqual(["p2"]);
      expect(state(doc).deliverables.map((d) => d.id)).toStrictEqual([
        "d-free",
      ]);
    });

    it("rejects an unknown project and tolerates a project without scope", () => {
      const doc = craft({
        projects: [rawProject({ id: "p-noscope", scope: null })],
      });

      const next = apply(
        doc,
        removeProject({ projectId: "nope" }),
        removeProject({ projectId: "p-noscope" }),
      );

      expect(errors(next)).toStrictEqual(["Project not found"]);
      expect(state(next).projects).toStrictEqual([]);
    });
  });

  describe("budget invariants", () => {
    it("setProjectTotalBudget derives each deliverable's margin from budget / total cost", () => {
      const doc = apply(
        costed(),
        setProjectTotalBudget({ projectId: "p1", totalBudget: 450 }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(project(doc)?.budget).toBe(450);
      expect(anchorOf(doc, "d1")?.margin).toBe(50);
      expect(anchorOf(doc, "d2")?.margin).toBe(50);

      // a budget equal to cost means no margin at all
      const atCost = apply(
        doc,
        setProjectTotalBudget({ projectId: "p1", totalBudget: 300 }),
      );
      expect(anchorOf(atCost, "d1")?.margin).toBe(0);
      expect(project(atCost)?.budget).toBe(300);
    });

    it("setProjectTotalBudget fixes the envelope even before anything is quoted", () => {
      const doc = apply(
        utils.createDocument(),
        addProject({ id: "p1", code: "P1", title: "Free" }),
        addProjectDeliverable({
          projectId: "p1",
          deliverableId: "d1",
          title: "Uncosted",
        }),
        setProjectTotalBudget({ projectId: "p1", totalBudget: 100 }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(project(doc)).toMatchObject({ budget: 100, targetBudget: 100 });
      // nothing to solve yet: the quote has no cost, so its margin is untouched
      expect(anchorOf(doc, "d1")?.margin).toBe(0);
    });

    it("setProjectMargin applies the margin to every deliverable and recomputes the budget", () => {
      const doc = apply(
        costed(),
        setProjectMargin({ projectId: "p1", margin: 20 }),
      );

      expect(errors(doc)).toStrictEqual([]);
      expect(anchorOf(doc, "d1")?.margin).toBe(20);
      expect(anchorOf(doc, "d2")?.margin).toBe(20);
      // (200 + 100) * 1.20
      expect(project(doc)?.budget).toBe(360);
    });

    it("setProjectMargin rejects a project with no deliverables", () => {
      const doc = apply(
        utils.createDocument(),
        addProject({ id: "p1", code: "P1", title: "Empty" }),
        setProjectMargin({ projectId: "p1", margin: 5 }),
      );

      expect(lastError(doc)).toBe(
        "Project deliverable set has no deliverables",
      );
    });

    it("skips deliverables without an anchor or missing from the document", () => {
      const doc = withScopedDeliverables(
        [
          rawDeliverable({
            id: "d-anchor",
            budgetAnchor: {
              project: "p1",
              unit: "Hours",
              unitCost: 10,
              quantity: 1,
              margin: 0,
              marginPinned: false,
            },
          }),
          rawDeliverable({ id: "d-noanchor", budgetAnchor: null }),
        ],
        ["d-dangling"],
      );

      const next = apply(
        doc,
        setProjectMargin({ projectId: "p1", margin: 50 }),
        setProjectTotalBudget({ projectId: "p1", totalBudget: 20 }),
      );

      expect(errors(next)).toStrictEqual([]);
      expect(anchorOf(next, "d-noanchor")).toBeNull();
      // margin path: 20 / 10 = 2
      // a margin set by a person is pinned: the fixed budget of 20 leaves it alone
      expect(anchorOf(next, "d-anchor")?.margin).toBe(50);
      expect(project(next)).toMatchObject({ budget: 20, targetBudget: 20 });
    });

    it("also recomputes milestone budgets, skipping milestones without scope", () => {
      const doc = apply(
        craft({
          roadmaps: [
            rawRoadmap({
              id: "r1",
              milestones: [rawMilestone({ id: "m-noscope", scope: null })],
            }),
          ],
          projects: [rawProject({ id: "p-noscope", scope: null })],
        }),
        addMilestone({ id: "m1", roadmapId: "r1" }),
        addProject({ id: "p1", code: "P1", title: "P" }),
        addProjectDeliverable({
          projectId: "p1",
          deliverableId: "d1",
          title: "D",
        }),
      );

      const next = apply(
        doc,
        setDeliverableBudgetAnchorProject({
          deliverableId: "d1",
          unitCost: 10,
          quantity: 1,
          margin: 0,
        }),
      );

      expect(errors(next)).toStrictEqual([]);
      expect(project(next)?.budget).toBe(10);
      expect(
        state(next).roadmaps[0].milestones.map((m) => m.budget),
      ).toStrictEqual([0, 0]);
    });

    it("records errors for unknown project and project without scope", () => {
      const doc = craft({
        projects: [rawProject({ id: "p-noscope", scope: null })],
      });

      const next = apply(
        doc,
        setProjectMargin({ projectId: "nope", margin: 1 }),
        setProjectTotalBudget({ projectId: "nope", totalBudget: 1 }),
        setProjectMargin({ projectId: "p-noscope", margin: 1 }),
      );

      expect(errorAt(next, 0)).toBe("Project not found");
      expect(errorAt(next, 1)).toBe("Project not found");
      expect(errorAt(next, 2)).toContain("Project deliverable set not found");
    });
  });

  describe("addProjectDeliverable / removeProjectDeliverable", () => {
    it("creates and links, then unlinks and resets the anchor project", () => {
      const doc = apply(
        utils.createDocument(),
        addProject({ id: "p1", code: "P1", title: "P" }),
        addProjectDeliverable({
          projectId: "p1",
          deliverableId: "d1",
          title: "One",
        }),
        addProjectDeliverable({
          projectId: "p1",
          deliverableId: "d2",
          title: "Two",
        }),
        setDeliverableBudgetAnchorProject({
          deliverableId: "d1",
          unit: "StoryPoints",
          unitCost: 3,
          quantity: 3,
          margin: 5,
          marginPinned: false,
        }),
      );
      expect(errors(doc)).toStrictEqual([]);
      expect(project(doc)?.scope?.deliverables).toStrictEqual(["d1", "d2"]);
      expect(anchorOf(doc, "d1")?.project).toBe("p1");

      const next = apply(
        doc,
        removeProjectDeliverable({ projectId: "p1", deliverableId: "d1" }),
      );
      expect(lastError(next)).toBeUndefined();
      expect(project(next)?.scope?.deliverables).toStrictEqual(["d2"]);
      expect(anchorOf(next, "d2")?.project).toBe("p1");
      expect(anchorOf(next, "d1")).toStrictEqual({
        project: "",
        unit: "StoryPoints",
        unitCost: 3,
        quantity: 3,
        margin: 5,
        marginPinned: false,
      });
      expect(project(next)?.budget).toBe(0);
    });

    it("falls back to default anchor values when unlinking a deliverable with no anchor", () => {
      const doc = withScopedDeliverables([
        rawDeliverable({ id: "d1", budgetAnchor: null }),
      ]);

      const next = apply(
        doc,
        removeProjectDeliverable({ projectId: "p1", deliverableId: "d1" }),
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

    it("records errors for unknown project or missing scope, adding nothing", () => {
      const doc = craft({
        projects: [rawProject({ id: "p-noscope", scope: null })],
      });

      const next = apply(
        doc,
        addProjectDeliverable({
          projectId: "nope",
          deliverableId: "d1",
          title: "x",
        }),
        addProjectDeliverable({
          projectId: "p-noscope",
          deliverableId: "d1",
          title: "x",
        }),
        removeProjectDeliverable({ projectId: "nope", deliverableId: "d1" }),
        removeProjectDeliverable({
          projectId: "p-noscope",
          deliverableId: "d1",
        }),
      );

      expect(errorAt(next, 0)).toBe("Project not found");
      expect(errorAt(next, 1)).toBe("Project deliverable set not found");
      expect(errorAt(next, 2)).toBe("Project not found");
      expect(errorAt(next, 3)).toBe("Project deliverable set not found");
      expect(state(next).deliverables).toStrictEqual([]);
    });
  });

  describe("progress invariant", () => {
    it("sums story points when every deliverable uses them", () => {
      const doc = withScopedDeliverables([
        rawDeliverable({ id: "a", workProgress: storyPointsProgress(10, 4) }),
        rawDeliverable({
          id: "b",
          workProgress: storyPointsProgress(6, 6),
          status: "DELIVERED",
        }),
      ]);

      const next = apply(doc, editDeliverablesSet({ projectId: "p1" }));

      expect(errors(next)).toStrictEqual([]);
      expect(project(next)?.scope).toMatchObject({
        progress: storyPointsProgress(16, 10),
        deliverablesCompleted: { total: 2, completed: 1 },
      });
    });

    it("averages percentage equivalents across mixed progress types and ignores canceled work", () => {
      const doc = withScopedDeliverables(
        [
          rawDeliverable({ id: "pct", workProgress: percentageProgress(50) }),
          rawDeliverable({
            id: "sp",
            workProgress: storyPointsProgress(4, 2),
          }),
          rawDeliverable({
            id: "sp-empty",
            workProgress: storyPointsProgress(0, 0),
          }),
          rawDeliverable({
            id: "bin-done",
            workProgress: binaryProgress(true),
            status: "TODO",
          }),
          rawDeliverable({
            id: "bin-wip",
            workProgress: binaryProgress(false),
            status: "IN_PROGRESS",
          }),
          rawDeliverable({
            id: "bin-todo",
            workProgress: binaryProgress(false),
            status: "TODO",
          }),
          rawDeliverable({
            id: "bin-null",
            workProgress: {
              value: null,
              total: null,
              completed: null,
              done: null,
            },
          }),
          rawDeliverable({ id: "none", workProgress: null }),
          rawDeliverable({
            id: "delivered",
            workProgress: percentageProgress(100),
            status: "DELIVERED",
          }),
          rawDeliverable({
            id: "canceled",
            workProgress: percentageProgress(100),
            status: "CANCELED",
          }),
          rawDeliverable({
            id: "wontdo",
            workProgress: percentageProgress(100),
            status: "WONT_DO",
          }),
        ],
        ["dangling"],
      );

      const next = apply(doc, editDeliverable({ id: "pct", title: "touch" }));

      expect(errors(next)).toStrictEqual([]);
      // (50 + 50 + 0 + 100 + 50 + 0 + 0 + 0 + 100) / 9
      expect(project(next)?.scope).toMatchObject({
        progress: percentageProgress(38.89),
        deliverablesCompleted: { total: 9, completed: 2 },
      });
    });

    it("resets progress when every deliverable is ignored or missing", () => {
      const doc = withScopedDeliverables(
        [
          rawDeliverable({
            id: "canceled",
            workProgress: percentageProgress(100),
            status: "CANCELED",
          }),
        ],
        ["dangling"],
      );

      const next = apply(
        doc,
        editDeliverablesSet({ projectId: "p1", status: "CANCELED" }),
      );

      expect(errors(next)).toStrictEqual([]);
      expect(project(next)?.scope).toMatchObject({
        status: "CANCELED",
        progress: percentageProgress(0),
        deliverablesCompleted: { total: 0, completed: 0 },
      });
    });

    it("recomputes milestone scopes too, skipping milestones and projects without scope", () => {
      const doc = craft({
        deliverables: [
          rawDeliverable({ id: "d1", workProgress: percentageProgress(30) }),
        ],
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
              rawMilestone({ id: "m-noscope", scope: null }),
            ],
          }),
        ],
        projects: [rawProject({ id: "p-noscope", scope: null })],
      });

      const next = apply(doc, editDeliverable({ id: "d1", title: "touch" }));

      expect(errors(next)).toStrictEqual([]);
      expect(state(next).roadmaps[0].milestones[0].scope).toMatchObject({
        progress: percentageProgress(30),
        deliverablesCompleted: { total: 1, completed: 0 },
      });
    });
  });
});

describe("execution links (wbsRef, knowledgeRefs, references)", () => {
  const seeded = () => craft({ projects: [rawProject({ id: "p1" })] });

  it("a new project starts with no wbs, no citations and no references", () => {
    const doc = apply(
      utils.createDocument(),
      addProject({ id: "p9", code: "P9", title: "Nine" }),
    );
    const p = project(doc, "p9");
    expect(p?.wbsRef).toBeNull();
    expect(p?.knowledgeRefs).toEqual([]);
    expect(p?.references).toEqual([]);
  });

  it("linkProjectWbs sets the wbs and a null unlinks it again", () => {
    let doc = apply(seeded(), linkProjectWbs({ projectId: "p1", wbsRef: "wbs-1" }));
    expect(project(doc)?.wbsRef).toBe("wbs-1");
    doc = apply(doc, linkProjectWbs({ projectId: "p1", wbsRef: null }));
    expect(project(doc)?.wbsRef).toBeNull();
    doc = apply(doc, linkProjectWbs({ projectId: "p1" }));
    expect(project(doc)?.wbsRef).toBeNull();
    expect(errors(doc)).toEqual([]);
  });

  it("addProjectKnowledgeRef appends once and refuses a duplicate", () => {
    let doc = apply(
      seeded(),
      addProjectKnowledgeRef({ projectId: "p1", ref: "note-a" }),
      addProjectKnowledgeRef({ projectId: "p1", ref: "note-b" }),
    );
    expect(project(doc)?.knowledgeRefs).toEqual(["note-a", "note-b"]);
    doc = apply(doc, addProjectKnowledgeRef({ projectId: "p1", ref: "note-a" }));
    expect(lastError(doc)).toBe("Project p1 already cites note-a");
    expect(project(doc)?.knowledgeRefs).toEqual(["note-a", "note-b"]);
  });

  it("removeProjectKnowledgeRef drops the citation and refuses an unknown one", () => {
    let doc = apply(
      seeded(),
      addProjectKnowledgeRef({ projectId: "p1", ref: "note-a" }),
      removeProjectKnowledgeRef({ projectId: "p1", ref: "note-a" }),
    );
    expect(project(doc)?.knowledgeRefs).toEqual([]);
    doc = apply(doc, removeProjectKnowledgeRef({ projectId: "p1", ref: "note-a" }));
    expect(lastError(doc)).toBe("Project p1 does not cite note-a");
  });

  it("setProjectReferences replaces the whole list", () => {
    let doc = apply(
      seeded(),
      setProjectReferences({ projectId: "p1", references: ["https://a.example", "https://b.example"] }),
    );
    expect(project(doc)?.references).toEqual(["https://a.example", "https://b.example"]);
    doc = apply(doc, setProjectReferences({ projectId: "p1", references: [] }));
    expect(project(doc)?.references).toEqual([]);
  });

  it("every execution-link operation reports ProjectNotFound for an unknown project", () => {
    const doc = apply(
      seeded(),
      linkProjectWbs({ projectId: "nope", wbsRef: "w" }),
      addProjectKnowledgeRef({ projectId: "nope", ref: "n" }),
      removeProjectKnowledgeRef({ projectId: "nope", ref: "n" }),
      setProjectReferences({ projectId: "nope", references: [] }),
    );
    expect(errors(doc)).toEqual(Array(4).fill("Project nope not found"));
    expect(project(doc)?.knowledgeRefs).toEqual([]);
  });

  it("tolerates a project stored before the fields existed", () => {
    // simulate a document written by the previous schema: no arrays at all
    const legacy = rawProject({ id: "old" }) as Partial<
      ReturnType<typeof rawProject>
    >;
    delete legacy.knowledgeRefs;
    let doc = craft({ projects: [legacy as ReturnType<typeof rawProject>] });
    doc = apply(doc, addProjectKnowledgeRef({ projectId: "old", ref: "n1" }));
    expect(errors(doc)).toEqual([]);
    expect(project(doc, "old")?.knowledgeRefs).toEqual(["n1"]);
    // and the remove path on a missing array is a clean not-found, not a crash
    let doc2 = craft({ projects: [legacy as ReturnType<typeof rawProject>] });
    doc2 = apply(doc2, removeProjectKnowledgeRef({ projectId: "old", ref: "n1" }));
    expect(lastError(doc2)).toBe("Project old does not cite n1");
  });
});
