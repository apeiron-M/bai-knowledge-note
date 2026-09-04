/**
 * The outline a scope of work / work breakdown is rendered to — the node's
 * searchable body in the graph index and the text the chat reads. One
 * renderer for both, so these tests are the contract for what a search hit
 * contains and what the chat can quote.
 */
import { describe, expect, it } from "vitest";
import type { WorkBreakdownStructureState } from "document-models/work-breakdown-structure";
import type { Deliverable, ScopeOfWorkState } from "document-models/scope-of-work";
import {
  buildGoalTree,
  goalProgress,
  goalSummary,
  renderScope,
  renderWbs,
  rollupDeliverables,
  wbsPhase,
} from "../../processors/graph-indexer/work-outline.js";

/* ── work breakdown ─────────────────────────────────────────────────────── */

const wbs: WorkBreakdownStructureState = {
  projectRef: "p1",
  sowRef: "s1",
  sowProjectId: "e1",
  owner: "liberuum",
  references: ["https://example.com/spec"],
  goals: [
    { id: "g1", description: "Ship the chat", status: "IN_PROGRESS", parentId: null, assignee: "liberuum", dependencies: [], blockReason: null, outcome: null, notes: [] },
    { id: "g1a", description: "Build the loop", status: "COMPLETED", parentId: "g1", assignee: null, dependencies: [], blockReason: null, outcome: "Merged", notes: [{ id: "n1", note: "Took two tries", author: "claude", timestamp: "2026-09-01T00:00:00Z" }] },
    { id: "g1b", description: "Wire the UI", status: "BLOCKED", parentId: "g1", assignee: "teep", dependencies: ["g1a"], blockReason: "Waiting on design tokens", outcome: null, notes: [] },
    { id: "g2", description: "Write the docs", status: "TODO", parentId: null, assignee: null, dependencies: [], blockReason: null, outcome: null, notes: [] },
    { id: "g3", description: "Old idea", status: "WONT_DO", parentId: null, assignee: null, dependencies: [], blockReason: null, outcome: null, notes: [] },
    { id: "orphan", description: "Parent vanished", status: "TODO", parentId: "missing", assignee: null, dependencies: [], blockReason: null, outcome: null, notes: [] },
  ],
};

describe("buildGoalTree", () => {
  it("nests children under parents and keeps input order", () => {
    const tree = buildGoalTree(wbs.goals);
    expect(tree.map((n) => n.goal.id)).toEqual(["g1", "g2", "g3", "orphan"]);
    expect(tree[0].children.map((n) => n.goal.id)).toEqual(["g1a", "g1b"]);
  });

  it("treats a goal whose parent is missing as a root rather than dropping it", () => {
    expect(buildGoalTree(wbs.goals).some((n) => n.goal.id === "orphan")).toBe(true);
  });
});

describe("goalProgress / goalSummary / wbsPhase", () => {
  it("counts completed over goals that still count, excluding WONT_DO", () => {
    expect(goalProgress(wbs.goals)).toEqual({
      completed: 1,
      total: 5,
      byStatus: { IN_PROGRESS: 1, COMPLETED: 1, BLOCKED: 1, TODO: 2, WONT_DO: 1 },
    });
  });

  it("summarises by status in reading order", () => {
    expect(goalSummary(wbs.goals)).toBe("6 goals: 1 completed, 1 in progress, 1 blocked, 2 to do, 1 won't do");
    expect(goalSummary([])).toBe("0 goals");
    expect(goalSummary([wbs.goals[3]])).toBe("1 goal: 1 to do");
  });

  it("derives the tree's phase: blocked beats in-progress, all done is completed, empty is to do", () => {
    expect(wbsPhase(wbs.goals)).toBe("BLOCKED");
    expect(wbsPhase(wbs.goals.filter((g) => g.status !== "BLOCKED"))).toBe("IN_PROGRESS");
    expect(wbsPhase([wbs.goals[1], wbs.goals[4]])).toBe("COMPLETED"); // WONT_DO ignored
    expect(wbsPhase([wbs.goals[3]])).toBe("TODO");
    expect(wbsPhase([])).toBe("TODO");
  });
});

describe("renderWbs", () => {
  it("renders an indented outline with status, assignee, block reason, outcome, notes, references", () => {
    const { text, data } = renderWbs(wbs, { id: "w1", projectName: "Vault chat" });
    expect(text.split("\n")[0]).toBe("# Work breakdown for Vault chat [[w1]]");
    expect(text).toContain('Delivers "Vault chat" in scope of work [[s1]]');
    expect(text).toContain("[IN_PROGRESS] Ship the chat");
    expect(text).toMatch(/\n  - \[COMPLETED\] Build the loop/);
    expect(text).toContain("outcome: Merged");
    expect(text).toContain("blocked: Waiting on design tokens");
    expect(text).toContain("depends on: Build the loop");
    expect(text).toContain("Took two tries");
    expect(text).toContain("1/5 goals completed (1 completed, 1 in progress, 1 blocked, 2 to do, 1 won't do)");
    expect(text).toContain("- https://example.com/spec");
    expect(data).toMatchObject({
      documentId: "w1",
      documentType: "bai/wbs",
      sowRef: "s1",
      sowProjectId: "e1",
      projectRef: "p1",
      owner: "liberuum",
      goalCount: 6,
      phase: "BLOCKED",
    });
    expect(data.progress.completed).toBe(1);
  });

  it("omits citation markers when rendered without an id (the indexer's case)", () => {
    const { text } = renderWbs({ ...wbs, sowRef: null }, { id: "" });
    expect(text.split("\n")[0]).toBe("# Work breakdown");
    expect(text).not.toContain("[[");
  });
});

/* ── scope of work ──────────────────────────────────────────────────────── */

function deliverable(over: Partial<Deliverable> & Pick<Deliverable, "id" | "code" | "title">): Deliverable {
  return {
    owner: null,
    icon: null,
    description: "",
    status: "TODO",
    workProgress: null,
    keyResults: [],
    budgetAnchor: null,
    goalRef: null,
    ...over,
  };
}

const scope: ScopeOfWorkState = {
  title: "Powerhouse PMF",
  description: "Scoping approaches for the demo.",
  status: "IN_PROGRESS",
  contributors: [
    { id: "a-frank", name: "Frank", icon: null, description: "PM" },
    { id: "a-teep", name: "Teep", icon: null, description: null },
  ],
  projects: [
    {
      id: "e1", slug: "ppd", code: "PPD", title: "Paperless demo", projectOwner: "a-frank", abstract: "First demo", imageUrl: null,
      scope: { deliverables: ["d1", "d2"], status: "IN_PROGRESS", progress: { value: 0, total: null, completed: null, done: null }, deliverablesCompleted: { total: 2, completed: 1 } },
      budgetType: "OPEX", currency: "USD", budget: 1320, targetBudget: null, expenditure: { percentage: 0, actuals: 0, cap: 0 },
      wbsRef: "w9", knowledgeRefs: ["n-a", "n-missing"], references: ["https://example.com"],
    },
    {
      id: "e2", slug: "auth", code: "AUTH", title: "Auth enforcement", projectOwner: "someone-else", abstract: null, imageUrl: null,
      scope: { deliverables: ["d3"], status: "TODO", progress: { value: 0, total: null, completed: null, done: null }, deliverablesCompleted: { total: 1, completed: 0 } },
      budgetType: "CAPEX", currency: "EUR", budget: 5000, targetBudget: 5000, expenditure: { percentage: 6, actuals: 300, cap: 5000 },
      wbsRef: null, knowledgeRefs: [], references: [],
    },
  ],
  deliverables: [
    deliverable({
      id: "d1", code: "PPD-01", title: "Configured instance", owner: "a-frank", status: "DELIVERED",
      workProgress: { done: true, value: null, total: null, completed: null },
      keyResults: [{ id: "k", title: "Shipped", link: "https://x.example" }],
      budgetAnchor: { project: "e1", unit: "Hours", unitCost: 120, quantity: 10, margin: 10, marginPinned: true },
      goalRef: "g1",
    }),
    deliverable({
      id: "d2", code: "PPD-02", title: "Payments", description: "Stripe first,\nthen invoices.", status: "IN_PROGRESS",
      workProgress: { done: null, value: null, total: 8, completed: 3 },
      goalRef: "g-missing",
    }),
    deliverable({
      id: "d3", code: "AUTH-01", title: "Scope enforcement", owner: "a-teep", status: "TODO",
      budgetAnchor: { project: "e2", unit: "StoryPoints", unitCost: 400, quantity: 14, margin: 0, marginPinned: false },
    }),
    deliverable({ id: "d4", code: "", title: "Loose end", status: "DRAFT" }),
  ],
  roadmaps: [
    {
      id: "r", slug: "h2", title: "H2", description: "Second half",
      milestones: [
        {
          id: "m1", sequenceCode: "M1", title: "Demo ready", description: "Everything for the first demo", deliveryTarget: "2026-08-28",
          scope: { deliverables: ["d1", "d2"], status: "IN_PROGRESS", progress: { value: 0, total: null, completed: null, done: null }, deliverablesCompleted: { total: 2, completed: 1 } },
          coordinators: ["a-frank", "ghost"], budget: 2000,
        },
        { id: "m2", sequenceCode: "M2", title: "Hardening", description: "", deliveryTarget: "", scope: null, coordinators: [], budget: null },
      ],
    },
  ],
};

const w9: WorkBreakdownStructureState = {
  projectRef: null, sowRef: "s1", sowProjectId: "e1", owner: "Frank", references: [],
  goals: [
    { id: "g1", description: "Install", status: "COMPLETED", parentId: null, assignee: null, dependencies: [], blockReason: null, outcome: null, notes: [] },
    { id: "g2", description: "Pay", status: "BLOCKED", parentId: null, assignee: null, dependencies: [], blockReason: "keys", outcome: null, notes: [] },
  ],
};

describe("rollupDeliverables", () => {
  it("excludes closed deliverables and averages percentages", () => {
    const ds = scope.deliverables;
    expect(rollupDeliverables(ds)).toEqual({ delivered: 1, total: 4, pct: 34.38 }); // 100, 37.5, 0, 0
    expect(rollupDeliverables([...ds, deliverable({ id: "x", code: "X", title: "x", status: "CANCELED" })]).total).toBe(4);
    expect(rollupDeliverables([])).toEqual({ delivered: 0, total: 0, pct: 0 });
  });

  it("uses story points when every deliverable carries them", () => {
    const sp = (id: string, completed: number, total: number) =>
      deliverable({ id, code: id, title: id, workProgress: { total, completed, value: null, done: null } });
    expect(rollupDeliverables([sp("a", 3, 8), sp("b", 5, 8)])).toEqual({ delivered: 0, total: 2, pct: 50 });
  });
});

describe("renderScope", () => {
  const full = renderScope({
    id: "s1",
    scope,
    wbsById: new Map([["w9", w9]]),
    noteTitles: new Map([["n-a", "A note"]]),
  });

  it("heads with the scope's title, status and citation marker, then its description", () => {
    const lines = full.text.split("\n");
    expect(lines[0]).toBe("# Scope of work: Powerhouse PMF — IN_PROGRESS [[s1]]");
    expect(lines[2]).toBe("Scoping approaches for the demo.");
  });

  it("renders each envelope with owner, set status, progress and a derived budget", () => {
    expect(full.text).toContain("### PPD · Paperless demo — owner Frank (IN_PROGRESS) · 1/2 delivered · 68.75%");
    expect(full.text).toContain("First demo");
    expect(full.text).toContain("Budget: 1,320 USD (OPEX), derived from 1 quoted deliverable");
    // An owner id that is not a contributor is shown as-is, never dropped.
    expect(full.text).toContain("### AUTH · Auth enforcement — owner someone-else (TODO) · 0/1 delivered · 0%");
  });

  it("explains a fixed budget against its quoted lines, and spend against the cap", () => {
    expect(full.text).toContain("Budget: fixed 5,000 EUR (CAPEX); quoted lines 5,600 EUR → over by 600 EUR");
    expect(full.text).toContain("Spent: 300 EUR of 5,000 EUR cap (6%)");
    const auth = full.data.envelopes[1];
    expect(auth).toMatchObject({ targetBudget: 5000, quotedBudget: 5600, budget: 5000, currency: "EUR", budgetType: "CAPEX" });
    expect(auth.expenditure).toEqual({ actuals: 300, cap: 5000, percentage: 6 });
  });

  it("gives every deliverable its goal, owner, progress, quote, milestone, description and key results", () => {
    expect(full.text).toContain(
      "- [DELIVERED] PPD-01 Configured instance — goal: Install (COMPLETED); owner Frank; done; quote: 10 hours × 120 USD = 1,200 USD, +10% margin → 1,320 USD; milestone M1",
    );
    expect(full.text).toContain("    KR Shipped: https://x.example");
    // A goalRef the WBS does not know is not invented; SP progress and a
    // multi-line description are flattened onto the outline.
    expect(full.text).toContain("- [IN_PROGRESS] PPD-02 Payments — 3/8 SP; milestone M1");
    expect(full.text).toContain("    Stripe first, then invoices.");
    // Zero margin: no margin clause. Story points as the unit.
    expect(full.text).toContain("- [TODO] AUTH-01 Scope enforcement — owner Teep; quote: 14 story points × 400 EUR = 5,600 EUR");
    const d1 = full.data.envelopes[0].deliverables[0];
    expect(d1).toEqual({
      id: "d1", code: "PPD-01", title: "Configured instance", status: "DELIVERED", owner: "Frank",
      progress: "done", cost: 1200, budget: 1320, milestone: "M1", goal: "Install",
    });
  });

  it("joins the work breakdown and the cited knowledge, and exposes the WBS as a citable object", () => {
    expect(full.text).toContain("Work breakdown [[w9]]: 1/2 goals completed (1 blocked)");
    expect(full.text).toContain("Knowledge: A note [[n-a]]; [[n-missing]]");
    expect(full.text).toContain("References: https://example.com");
    const ppd = full.data.envelopes[0];
    expect(ppd.wbs).toEqual({ documentId: "w9", documentType: "bai/wbs", title: "Work breakdown for Paperless demo" });
    expect(ppd.goals).toEqual({ completed: 1, total: 2, byStatus: { COMPLETED: 1, BLOCKED: 1 } });
    expect(ppd.knowledgeRefs).toEqual([
      { documentId: "n-a", title: "A note" },
      { documentId: "n-missing", title: null },
    ]);
    expect(full.data.envelopes[1].wbs).toBeNull();
  });

  it("lists deliverables no envelope funds instead of losing them", () => {
    expect(full.text).toContain("## Unfunded deliverables (not in any project)\n- [DRAFT] Loose end");
    expect(full.data.unfundedDeliverables.map((d) => d.id)).toEqual(["d4"]);
    expect(full.data.deliverables).toEqual({ delivered: 1, total: 4 });
  });

  it("renders the schedule with each milestone's status, progress, coordinators, budget and deliverables", () => {
    expect(full.text).toContain("Roadmap: H2 — Second half");
    expect(full.text).toContain("- M1 Demo ready — 2026-08-28 (IN_PROGRESS); 1/2 delivered · 68.75%; coordinators Frank, ghost; budget 2,000");
    expect(full.text).toContain("    Everything for the first demo");
    expect(full.text).toContain("    deliverables: PPD-01, PPD-02");
    expect(full.text).toContain("- M2 Hardening — no date (DRAFT)\n    deliverables: none scheduled");
    expect(full.data.milestones[0]).toMatchObject({
      code: "M1", target: "2026-08-28", status: "IN_PROGRESS", coordinators: ["Frank", "ghost"], budget: 2000, deliverables: ["PPD-01", "PPD-02"],
    });
  });

  it("lists contributors with ids and descriptions", () => {
    expect(full.text).toContain("## Contributors\n- Frank (a-frank) — PM\n- Teep (a-teep)");
    expect(full.data.contributors).toEqual([
      { id: "a-frank", name: "Frank", description: "PM" },
      { id: "a-teep", name: "Teep", description: null },
    ]);
  });

  it("degrades to ids without joins and to no markers without an id — the indexer's rendering", () => {
    const bare = renderScope({ id: "", scope, wbsById: new Map(), noteTitles: new Map() });
    expect(bare.text.split("\n")[0]).toBe("# Scope of work: Powerhouse PMF — IN_PROGRESS");
    expect(bare.text).toContain("Work breakdown [[w9]]\n");
    expect(bare.text).toContain("Knowledge: [[n-a]]; [[n-missing]]");
    expect(bare.text).toContain("- [DELIVERED] PPD-01 Configured instance — owner Frank; done;");
    expect(bare.data.envelopes[0].goals).toBeNull();
    expect(bare.data.envelopes[0].deliverables[0].goal).toBeNull();
  });

  it("says so when a scope is empty", () => {
    const empty = renderScope({
      id: "",
      scope: { title: "", description: "", status: "DRAFT", deliverables: [], projects: [], roadmaps: [], contributors: [] },
      wbsById: new Map(),
      noteTitles: new Map(),
    });
    expect(empty.text).toContain("# Scope of work: (untitled) — DRAFT");
    expect(empty.text).toContain("No projects yet.");
    expect(empty.text).toContain("No roadmap yet.");
    expect(empty.text).toContain("None listed.");
    expect(empty.text).not.toContain("Unfunded");
  });
});
