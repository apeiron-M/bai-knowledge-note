import { describe, expect, it } from "vitest";
import type { ScopeOfWorkState } from "document-models/scope-of-work";
import { locate } from "./model.js";

const set = (deliverables: string[]) => ({
  deliverables,
  status: "DRAFT" as const,
  progress: { value: 0, total: null, completed: null, done: null },
  deliverablesCompleted: { total: deliverables.length, completed: 0 },
});

const s: ScopeOfWorkState = {
  title: "S",
  description: "",
  status: "DRAFT",
  contributors: [{ id: "a1", name: "Frank", icon: null, description: null }],
  projects: [
    {
      id: "e1", slug: "e1", code: "E1", title: "Envelope", projectOwner: null, abstract: null, imageUrl: null,
      scope: set(["d1"]), budgetType: null, currency: null, budget: null, targetBudget: null, expenditure: null,
      wbsRef: null, knowledgeRefs: [], references: [],
    },
  ],
  deliverables: [
    { id: "d1", owner: null, icon: null, title: "Funded", code: "E1-01", description: "", status: "TODO", workProgress: null, keyResults: [], budgetAnchor: null, goalRef: null },
    { id: "d2", owner: null, icon: null, title: "Loose", code: "", description: "", status: "DRAFT", workProgress: null, keyResults: [], budgetAnchor: null, goalRef: null },
  ],
  roadmaps: [
    { id: "r1", slug: "r1", title: "R", description: "", milestones: [
      { id: "m1", sequenceCode: "M1", title: "M", description: "", deliveryTarget: "", scope: null, coordinators: [], budget: null },
    ] },
  ],
};

describe("locate", () => {
  it("opens an envelope, roadmap, milestone or contributor in the view that shows it", () => {
    expect(locate(s, "e1")).toEqual({ view: { kind: "project", id: "e1" }, selected: null });
    expect(locate(s, "r1")).toEqual({ view: { kind: "roadmap", id: "r1" }, selected: null });
    expect(locate(s, "m1")).toEqual({ view: { kind: "milestone", id: "m1" }, selected: null });
    expect(locate(s, "a1")).toEqual({ view: { kind: "team" }, selected: null });
  });

  it("selects a deliverable inside its funding envelope, or in the flat list when unfunded", () => {
    expect(locate(s, "d1")).toEqual({ view: { kind: "project", id: "e1" }, selected: "d1" });
    expect(locate(s, "d2")).toEqual({ view: { kind: "deliverables" }, selected: "d2" });
  });

  it("returns null for an id the scope does not hold", () => {
    expect(locate(s, "nope")).toBeNull();
  });
});
