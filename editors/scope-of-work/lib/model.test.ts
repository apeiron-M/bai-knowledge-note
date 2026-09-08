import { describe, expect, it } from "vitest";
import type {
  Deliverable,
  Milestone,
  ScopeOfWorkState,
} from "document-models/scope-of-work";
import {
  deliveryHorizon,
  isOverdue,
  locate,
  milestoneIndex,
  milestoneState,
  money,
  moneyAmount,
  nextMilestone,
  planMode,
  planWindow,
  projectIndex,
  triage,
  worstStatus,
} from "./model.js";

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

describe("money formatting across fiat and tokens", () => {
  it("keeps fiat symbols", () => {
    expect(money(412637.5, "USD")).toBe("$412,637.50");
    expect(money(117204.5, "EUR")).toBe("€117,204.50");
  });
  it("formats tokens as a grouped number with the code after it", () => {
    // Intl throws on the 4-letter USDS and prefixes the 3-letter DAI; both used
    // to come out differently from each other and from fiat.
    expect(money(61070.5, "USDS")).toBe("61,070.50 USDS");
    expect(money(40000, "DAI")).toBe("40,000.00 DAI");
  });
  it("exposes the bare amount for stacked layouts", () => {
    expect(moneyAmount(1234.5)).toBe("1,234.50");
  });
});

describe("delivery horizon, triage and the plan window", () => {
  const today = new Date("2026-09-08T12:00:00Z");
  const dl = (id: string, status: Deliverable["status"]): Deliverable => ({
    id, owner: null, icon: null, title: id, code: id.toUpperCase(), description: "", status,
    workProgress: null, keyResults: [], budgetAnchor: null, goalRef: null,
  });
  const ms = (
    id: string,
    sequenceCode: string,
    deliveryTarget: string,
    deliverables: string[],
  ): Milestone => ({
    id, sequenceCode, title: id, description: "", deliveryTarget,
    scope: deliverables.length > 0 ? set(deliverables) : null,
    coordinators: [], budget: null,
  });
  // a: delivered in July · h: delivered, though its date is still a week away
  // c: blocked, its milestone a month late · d: in progress at the next date
  // e: to do, later · f: canceled and scheduled nowhere · g: to do, unfunded and unscheduled
  const big: ScopeOfWorkState = {
    ...s,
    deliverables: [
      dl("a", "DELIVERED"), dl("h", "DELIVERED"), dl("c", "BLOCKED"), dl("d", "IN_PROGRESS"),
      dl("e", "TODO"), dl("f", "CANCELED"), dl("g", "TODO"),
    ],
    projects: s.projects.map((p) => ({ ...p, scope: set(["a", "h", "c", "d", "e", "f"]) })),
    roadmaps: s.roadmaps.map((r) => ({
      ...r,
      // deliberately out of order: the horizon sorts by date
      milestones: [
        ms("then", "M4", "2026-10-30", ["e"]),
        ms("late", "M2", "2026-08-15", ["c"]),
        ms("done", "M1", "2026-07-01", ["a"]),
        ms("early", "M0", "2026-09-15", ["h"]),
        ms("next", "M3", "2026-09-30", ["d"]),
        ms("undated", "M5", "", []),
      ],
    })),
  };
  const ids = (refs: { milestone: Milestone }[]) => refs.map((r) => r.milestone.id);
  const at = (id: string): Milestone => {
    const m = big.roadmaps.flatMap((r) => r.milestones).find((x) => x.id === id);
    if (!m) throw new Error(`no milestone ${id}`);
    return m;
  };
  const dv = (id: string): Deliverable => {
    const d = big.deliverables.find((x) => x.id === id);
    if (!d) throw new Error(`no deliverable ${id}`);
    return d;
  };
  const h = deliveryHorizon(big, today);

  it("sorts every milestone into delivered, overdue, upcoming or undated, by date", () => {
    expect(ids(h.delivered)).toEqual(["done", "early"]);
    expect(ids(h.overdue)).toEqual(["late"]);
    expect(ids(h.upcoming)).toEqual(["next", "then"]);
    expect(ids(h.undated)).toEqual(["undated"]);
  });

  it("treats a milestone finished ahead of its date as done, not next", () => {
    expect(nextMilestone(big, today)?.milestone.id).toBe("next");
    expect(milestoneState(big, at("early"), today)).toBe("done");
    expect(milestoneState(big, at("next"), today)).toBe("live");
    expect(milestoneState(big, at("late"), today)).toBe("");
    expect(isOverdue(big, at("late"), today)).toBe(true);
    expect(isOverdue(big, at("done"), today)).toBe(false);
    expect(isOverdue(big, at("undated"), today)).toBe(false);
  });

  it("counts what needs attention, ignoring canceled work", () => {
    expect(triage(big, today)).toEqual({ blocked: 1, unfunded: 1, unscheduled: 1, overdue: 1 });
  });

  it("indexes deliverables to their milestone and envelope once", () => {
    expect(milestoneIndex(big).get("c")?.milestone.id).toBe("late");
    expect(milestoneIndex(big).has("g")).toBe(false);
    expect(projectIndex(big).get("a")?.id).toBe("e1");
    expect(projectIndex(big).has("g")).toBe(false);
  });

  it("windows the plan to the next open milestones and folds the rest", () => {
    const one = planWindow(h, 1);
    expect(ids(one.done)).toEqual(["done", "early"]);
    expect(ids(one.shown)).toEqual(["late"]);
    expect(ids(one.later)).toEqual(["next", "then", "undated"]);
    const wide = planWindow(h, 8);
    expect(ids(wide.shown)).toEqual(["late", "next", "then"]);
    expect(ids(wide.later)).toEqual(["undated"]);
  });

  it("colours a cell by its worst status", () => {
    expect(worstStatus([])).toBe("");
    expect(worstStatus([dv("a"), dv("h")])).toBe("DELIVERED");
    expect(worstStatus([dv("a"), dv("d")])).toBe("IN_PROGRESS");
    expect(worstStatus([dv("d"), dv("c")])).toBe("BLOCKED");
    expect(worstStatus([dv("e")])).toBe("");
  });
});

describe("plan density", () => {
  it("shows cards only while the grid is a few projects by a few milestones", () => {
    expect(planMode(3, 1)).toBe("cards");
    expect(planMode(5, 4)).toBe("cards");
    expect(planMode(5, 5)).toBe("chips");
    expect(planMode(6, 1)).toBe("chips");
    expect(planMode(0, 0)).toBe("cards");
  });
});
