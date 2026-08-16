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

    it("should calculate rollup with mixed statuses", () => {
      const goals = [
        { status: "COMPLETED" as GoalStatus },
        { status: "WONT_DO" as GoalStatus },
        { status: "BLOCKED" as GoalStatus },
        { status: "IN_PROGRESS" as GoalStatus },
        { status: "TODO" as GoalStatus },
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
      const goals = [{ status: "COMPLETED" as GoalStatus }];
      const result = goalRollup(goals);
      expect(result).toEqual({
        total: 1,
        finished: 1,
        blocked: 0,
        inProgress: 0,
        pct: 100,
      });
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
