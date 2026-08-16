import type { Goal } from "document-models/work-breakdown-structure/v1";
import { describe, expect, it } from "vitest";
import { collectSubtreeIds, rebuildDepthFirst } from "../src/tree-utils.js";

const goal = (overrides: Partial<Goal> & Pick<Goal, "id">): Goal => ({
  description: "d",
  status: "TODO",
  parentId: null,
  assignee: null,
  dependencies: [],
  blockReason: null,
  outcome: null,
  notes: [],
  ...overrides,
});

describe("tree-utils", () => {
  describe("rebuildDepthFirst", () => {
    it("orders parents before children, siblings in array order", () => {
      const goals: Goal[] = [
        goal({ id: "a" }),
        goal({ id: "b" }),
        goal({ id: "a1", parentId: "a" }),
      ];
      expect(rebuildDepthFirst(goals).map((g) => g.id)).toEqual([
        "a",
        "a1",
        "b",
      ]);
    });

    it("appends orphans whose parentId points at a missing goal", () => {
      // The reducers never let this happen through the public operations
      // (createGoal/reorder validate parentId, deleteGoal removes whole
      // subtrees), so this exercises the safety net directly.
      const goals: Goal[] = [
        goal({ id: "orphan", parentId: "does-not-exist" }),
        goal({ id: "root" }),
      ];
      expect(rebuildDepthFirst(goals).map((g) => g.id)).toEqual([
        "root",
        "orphan",
      ]);
    });
  });

  describe("collectSubtreeIds", () => {
    it("returns just the root id when it has no children", () => {
      const goals: Goal[] = [goal({ id: "solo" })];
      expect(collectSubtreeIds(goals, "solo")).toEqual(new Set(["solo"]));
    });

    it("collects nested descendants but not unrelated siblings", () => {
      const goals: Goal[] = [
        goal({ id: "a" }),
        goal({ id: "a1", parentId: "a" }),
        goal({ id: "a1a", parentId: "a1" }),
        goal({ id: "b" }),
      ];
      expect(collectSubtreeIds(goals, "a")).toEqual(
        new Set(["a", "a1", "a1a"]),
      );
    });
  });
});
