import { describe, it, expect } from "vitest";
import {
  goalRollup,
  GOAL_STATUS_META,
  PROJECT_STATUS_META,
  DELIVERABLE_STATUS_META,
} from "./project-status.js";
import type { GoalStatus } from "document-models/work-breakdown-structure";

describe("project-status", () => {
  describe("goalRollup", () => {
    /** Build a goal row; `parentId` null means top-level. */
    const g = (
      id: string,
      status: GoalStatus,
      parentId: string | null = null,
    ) => ({ id, parentId, status });

    it("should handle empty goals array", () => {
      const result = goalRollup([]);
      expect(result).toEqual({
        total: 0,
        finished: 0,
        blocked: 0,
        inProgress: 0,
        pct: 0,
      });
    });

    it("should calculate rollup with mixed statuses on a flat WBS", () => {
      const goals = [
        g("1", "COMPLETED"),
        g("2", "WONT_DO"),
        g("3", "BLOCKED"),
        g("4", "IN_PROGRESS"),
        g("5", "TODO"),
      ];
      const result = goalRollup(goals);
      expect(result).toEqual({
        total: 5,
        finished: 2,
        blocked: 1,
        inProgress: 1,
        pct: 40,
      });
    });

    it("should calculate 100% when all goals are finished", () => {
      const goals = [g("1", "COMPLETED")];
      const result = goalRollup(goals);
      expect(result).toEqual({
        total: 1,
        finished: 1,
        blocked: 0,
        inProgress: 0,
        pct: 100,
      });
    });

    it("should exclude parent rows from progress, counting leaves only", () => {
      // A phase with 2 of 3 children done. Counting the parent as a unit of
      // work would report 2/4 = 50%; the work itself is 2/3 = 67%.
      const goals = [
        g("phase", "IN_PROGRESS"),
        g("a", "COMPLETED", "phase"),
        g("b", "COMPLETED", "phase"),
        g("c", "TODO", "phase"),
      ];
      const result = goalRollup(goals);
      expect(result.total).toBe(3);
      expect(result.finished).toBe(2);
      expect(result.pct).toBe(67);
    });

    it("should not let a completed parent inflate finished past its children", () => {
      const goals = [
        g("phase", "COMPLETED"),
        g("a", "COMPLETED", "phase"),
        g("b", "COMPLETED", "phase"),
      ];
      const result = goalRollup(goals);
      expect(result.total).toBe(2);
      expect(result.finished).toBe(2);
      expect(result.pct).toBe(100);
    });

    it("should exclude an unfinished parent from diluting the denominator", () => {
      const goals = [
        g("phase", "TODO"),
        g("a", "TODO", "phase"),
        g("b", "TODO", "phase"),
      ];
      const result = goalRollup(goals);
      expect(result.total).toBe(2);
      expect(result.pct).toBe(0);
    });

    it("should count a blocked parent in blocked even though it is not a leaf", () => {
      // blocked drives an alert badge, so it must see every row.
      const goals = [
        g("phase", "BLOCKED"),
        g("a", "TODO", "phase"),
        g("b", "TODO", "phase"),
      ];
      const result = goalRollup(goals);
      expect(result.blocked).toBe(1);
      expect(result.total).toBe(2);
    });

    it("should count in-progress parents in inProgress", () => {
      const goals = [
        g("phase", "IN_PROGRESS"),
        g("a", "IN_PROGRESS", "phase"),
        g("b", "TODO", "phase"),
      ];
      const result = goalRollup(goals);
      expect(result.inProgress).toBe(2);
      expect(result.total).toBe(2);
    });

    it("should handle nested grandchildren, counting only true leaves", () => {
      const goals = [
        g("step", "IN_PROGRESS"),
        g("editor", "COMPLETED", "step"),
        g("modal", "COMPLETED", "editor"),
        g("proc", "TODO", "step"),
      ];
      const result = goalRollup(goals);
      // leaves are "modal" and "proc" only
      expect(result.total).toBe(2);
      expect(result.finished).toBe(1);
      expect(result.pct).toBe(50);
    });

    it("should not divide by zero when every row is a parent (malformed cycle)", () => {
      const goals = [g("a", "TODO", "b"), g("b", "TODO", "a")];
      const result = goalRollup(goals);
      expect(result.total).toBe(0);
      expect(result.pct).toBe(0);
    });

    it("should ignore a parentId that references a missing goal", () => {
      const goals = [g("a", "COMPLETED", "ghost"), g("b", "TODO", "ghost")];
      const result = goalRollup(goals);
      expect(result.total).toBe(2);
      expect(result.finished).toBe(1);
      expect(result.pct).toBe(50);
    });
  });

  describe("GOAL_STATUS_META", () => {
    it("should have metadata for all GoalStatus values", () => {
      const statuses: GoalStatus[] = [
        "TODO",
        "IN_PROGRESS",
        "IN_REVIEW",
        "BLOCKED",
        "COMPLETED",
        "WONT_DO",
      ];

      statuses.forEach((status) => {
        expect(GOAL_STATUS_META[status]).toBeDefined();
        const meta = GOAL_STATUS_META[status];
        expect(meta.label).toBeDefined();
        expect(meta.fg).toBeDefined();
        expect(meta.bg).toBeDefined();
        expect(meta.border).toBeDefined();
        expect(meta.group).toMatch(/^(waiting|active|finished)$/);
      });
    });

    it("should have correct groups for GoalStatus", () => {
      expect(GOAL_STATUS_META.TODO.group).toBe("waiting");
      expect(GOAL_STATUS_META.BLOCKED.group).toBe("waiting");
      expect(GOAL_STATUS_META.IN_PROGRESS.group).toBe("active");
      expect(GOAL_STATUS_META.IN_REVIEW.group).toBe("active");
      expect(GOAL_STATUS_META.COMPLETED.group).toBe("finished");
      expect(GOAL_STATUS_META.WONT_DO.group).toBe("finished");
    });
  });

  describe("PROJECT_STATUS_META", () => {
    it("should have metadata for all ProjectStatus values", () => {
      const statuses = [
        "PLANNING",
        "ACTIVE",
        "ON_HOLD",
        "COMPLETED",
        "ARCHIVED",
      ] as const;

      statuses.forEach((status) => {
        expect(PROJECT_STATUS_META[status]).toBeDefined();
        const meta = PROJECT_STATUS_META[status];
        expect(meta.label).toBeDefined();
        expect(meta.fg).toBeDefined();
        expect(meta.bg).toBeDefined();
        expect(meta.border).toBeDefined();
      });
    });
  });

  describe("DELIVERABLE_STATUS_META", () => {
    it("should have metadata for all DeliverableStatus values", () => {
      const statuses = [
        "PLANNED",
        "IN_PROGRESS",
        "DELIVERED",
        "CANCELLED",
      ] as const;

      statuses.forEach((status) => {
        expect(DELIVERABLE_STATUS_META[status]).toBeDefined();
        const meta = DELIVERABLE_STATUS_META[status];
        expect(meta.label).toBeDefined();
        expect(meta.fg).toBeDefined();
        expect(meta.bg).toBeDefined();
        expect(meta.border).toBeDefined();
      });
    });
  });
});
