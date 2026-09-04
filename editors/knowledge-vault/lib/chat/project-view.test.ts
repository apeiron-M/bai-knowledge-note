import { describe, expect, it } from "vitest";
import type { WorkBreakdownStructureState } from "document-models/work-breakdown-structure";
import {
  buildGoalTree,
  goalProgress,
  renderWbs,
} from "./project-view.js";

const wbs: WorkBreakdownStructureState = {
  projectRef: "p1",
      sowRef: null,
      sowProjectId: null,
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
