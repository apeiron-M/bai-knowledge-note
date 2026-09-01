import { describe, expect, it } from "vitest";
import type { ProjectState } from "document-models/project";
import type { WorkBreakdownStructureState } from "document-models/work-breakdown-structure";
import {
  buildGoalTree,
  goalProgress,
  renderProject,
  renderWbs,
} from "./project-view.js";

const wbs: WorkBreakdownStructureState = {
  projectRef: "p1",
  owner: "liberuum",
  references: [],
  goals: [
    {
      id: "g1",
      description: "Ship the chat",
      status: "IN_PROGRESS",
      parentId: null,
      assignee: "liberuum",
      dependencies: [],
      blockReason: null,
      outcome: null,
      notes: [],
    },
    {
      id: "g1a",
      description: "Build the loop",
      status: "COMPLETED",
      parentId: "g1",
      assignee: null,
      dependencies: [],
      blockReason: null,
      outcome: "Merged",
      notes: [
        {
          id: "n1",
          note: "Took two tries",
          author: "claude",
          timestamp: "2026-09-01T00:00:00Z",
        },
      ],
    },
    {
      id: "g1b",
      description: "Wire the UI",
      status: "BLOCKED",
      parentId: "g1",
      assignee: "teep",
      dependencies: ["g1a"],
      blockReason: "Waiting on design tokens",
      outcome: null,
      notes: [],
    },
    {
      id: "g2",
      description: "Write the docs",
      status: "TODO",
      parentId: null,
      assignee: null,
      dependencies: [],
      blockReason: null,
      outcome: null,
      notes: [],
    },
    {
      id: "g3",
      description: "Old idea",
      status: "WONT_DO",
      parentId: null,
      assignee: null,
      dependencies: [],
      blockReason: null,
      outcome: null,
      notes: [],
    },
    {
      id: "orphan",
      description: "Parent vanished",
      status: "TODO",
      parentId: "missing",
      assignee: null,
      dependencies: [],
      blockReason: null,
      outcome: null,
      notes: [],
    },
  ],
};

const project: ProjectState = {
  name: "Vault chat",
  description: "Browser-only chat over the vault.",
  status: "ACTIVE",
  owner: "liberuum",
  targetDate: "2026-09-15",
  wbsRef: "w1",
  team: [
    { id: "t1", name: "liberuum", role: "Lead", kind: "HUMAN" },
    { id: "t2", name: "claude", role: "Implementation", kind: "AGENT" },
  ],
  deliverables: [
    {
      id: "d1",
      title: "Chat tab",
      description: "The interface",
      status: "IN_PROGRESS",
      goalRef: "g1",
      url: null,
      deliveredAt: null,
    },
    {
      id: "d2",
      title: "Docs",
      description: null,
      status: "PLANNED",
      goalRef: "g2",
      url: null,
      deliveredAt: null,
    },
    {
      id: "d3",
      title: "Unlinked",
      description: null,
      status: "DELIVERED",
      goalRef: null,
      url: "https://example.com",
      deliveredAt: "2026-09-01T00:00:00Z",
    },
  ],
  knowledgeRefs: ["n-a", "n-b"],
  references: ["https://openrouter.ai"],
  createdAt: "2026-08-01T00:00:00Z",
};

describe("buildGoalTree", () => {
  it("nests children under parents and keeps input order", () => {
    const tree = buildGoalTree(wbs.goals);
    expect(tree.map((n) => n.goal.id)).toEqual(["g1", "g2", "g3", "orphan"]);
    expect(tree[0].children.map((n) => n.goal.id)).toEqual(["g1a", "g1b"]);
  });

  it("treats a goal whose parent is missing as a root rather than dropping it", () => {
    const tree = buildGoalTree(wbs.goals);
    expect(tree.some((n) => n.goal.id === "orphan")).toBe(true);
  });
});

describe("goalProgress", () => {
  it("counts completed over goals that still count, excluding WONT_DO", () => {
    const p = goalProgress(wbs.goals);
    expect(p).toEqual({
      completed: 1,
      total: 5,
      byStatus: {
        IN_PROGRESS: 1,
        COMPLETED: 1,
        BLOCKED: 1,
        TODO: 2,
        WONT_DO: 1,
      },
    });
  });
});

describe("renderWbs", () => {
  it("renders an indented outline with status, assignee, block reason, outcome and notes", () => {
    const { text, data } = renderWbs(wbs, {
      id: "w1",
      projectName: "Vault chat",
    });
    expect(text).toContain("[IN_PROGRESS] Ship the chat");
    expect(text).toMatch(/\n  - \[COMPLETED\] Build the loop/);
    expect(text).toContain("outcome: Merged");
    expect(text).toContain("blocked: Waiting on design tokens");
    expect(text).toContain("depends on: Build the loop");
    expect(text).toContain("Took two tries");
    expect(text).toContain("1/5 goals completed");
    expect(data.goalCount).toBe(6);
    expect(data.progress.completed).toBe(1);
  });
});

describe("renderProject", () => {
  it("renders status, team, deliverables with their linked goal, the WBS outline and knowledge titles", () => {
    const titles = new Map([["n-a", "First note"]]);
    const { text, data } = renderProject({
      id: "p1",
      project,
      wbs,
      noteTitles: titles,
    });

    expect(text).toContain("Vault chat");
    expect(text).toContain("ACTIVE");
    expect(text).toContain("liberuum — Lead");
    expect(text).toContain("claude — Implementation (agent)");
    // deliverable → goal join
    expect(text).toMatch(
      /\[IN_PROGRESS\] Chat tab.*goal: Ship the chat \(IN_PROGRESS\)/,
    );
    expect(text).toMatch(/\[DELIVERED\] Unlinked.*https:\/\/example\.com/);
    // WBS inline
    expect(text).toContain("Build the loop");
    // knowledge refs with titles when known, id otherwise
    expect(text).toContain("First note [[n-a]]");
    expect(text).toContain("[[n-b]]");

    expect(data.deliverables.map((d) => d.goal?.id ?? null)).toEqual([
      "g1",
      "g2",
      null,
    ]);
    expect(data.deliverableProgress).toEqual({ delivered: 1, total: 3 });
  });

  it("copes with a project that has no WBS, team or deliverables yet", () => {
    const bare: ProjectState = {
      ...project,
      wbsRef: null,
      team: [],
      deliverables: [],
      knowledgeRefs: [],
      references: [],
    };
    const { text } = renderProject({
      id: "p1",
      project: bare,
      wbs: null,
      noteTitles: new Map(),
    });
    expect(text).toContain("No work breakdown linked");
    expect(text).toContain("No deliverables yet");
    expect(text).not.toMatch(/undefined|null/);
  });
});
