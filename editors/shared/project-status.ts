import type {
  GoalStatus,
  Goal,
} from "document-models/work-breakdown-structure";
import type {
  ProjectStatus,
  DeliverableStatus,
} from "document-models/project";

// Color palette: rgba(r, g, b, alpha)
// Gray: rgb(156, 163, 175)
// Blue: rgb(59, 130, 246)
// Red: rgb(248, 113, 113)
// Amber: rgb(245, 158, 11)
// Emerald: rgb(52, 211, 153)
// Mauve/Accent: rgb(203, 166, 247)

export const GOAL_STATUS_META: Record<
  GoalStatus,
  {
    label: string;
    fg: string;
    bg: string;
    border: string;
    group: "waiting" | "active" | "finished";
  }
> = {
  TODO: {
    label: "To Do",
    fg: "rgba(209, 213, 219, 1)",
    bg: "rgba(156, 163, 175, 0.15)",
    border: "rgba(156, 163, 175, 0.3)",
    group: "waiting",
  },
  IN_PROGRESS: {
    label: "In Progress",
    fg: "rgba(147, 197, 253, 1)",
    bg: "rgba(59, 130, 246, 0.15)",
    border: "rgba(59, 130, 246, 0.3)",
    group: "active",
  },
  IN_REVIEW: {
    label: "In Review",
    fg: "rgba(252, 211, 77, 1)",
    bg: "rgba(245, 158, 11, 0.15)",
    border: "rgba(245, 158, 11, 0.3)",
    group: "active",
  },
  BLOCKED: {
    label: "Blocked",
    fg: "rgba(252, 165, 165, 1)",
    bg: "rgba(248, 113, 113, 0.15)",
    border: "rgba(248, 113, 113, 0.3)",
    group: "waiting",
  },
  COMPLETED: {
    label: "Completed",
    fg: "rgba(110, 231, 183, 1)",
    bg: "rgba(52, 211, 153, 0.15)",
    border: "rgba(16, 185, 129, 0.3)",
    group: "finished",
  },
  WONT_DO: {
    label: "Won't Do",
    fg: "rgba(209, 213, 219, 1)",
    bg: "rgba(156, 163, 175, 0.15)",
    border: "rgba(156, 163, 175, 0.3)",
    group: "finished",
  },
};

export const PROJECT_STATUS_META: Record<
  ProjectStatus,
  {
    label: string;
    fg: string;
    bg: string;
    border: string;
  }
> = {
  PLANNING: {
    label: "Planning",
    fg: "rgba(252, 211, 77, 1)",
    bg: "rgba(245, 158, 11, 0.15)",
    border: "rgba(245, 158, 11, 0.3)",
  },
  ACTIVE: {
    label: "Active",
    fg: "rgba(110, 231, 183, 1)",
    bg: "rgba(52, 211, 153, 0.15)",
    border: "rgba(16, 185, 129, 0.3)",
  },
  ON_HOLD: {
    label: "On Hold",
    fg: "rgba(147, 197, 253, 1)",
    bg: "rgba(59, 130, 246, 0.15)",
    border: "rgba(59, 130, 246, 0.3)",
  },
  COMPLETED: {
    label: "Completed",
    fg: "var(--bai-accent)",
    bg: "rgba(203, 166, 247, 0.15)",
    border: "rgba(203, 166, 247, 0.3)",
  },
  ARCHIVED: {
    label: "Archived",
    fg: "rgba(209, 213, 219, 1)",
    bg: "rgba(156, 163, 175, 0.15)",
    border: "rgba(156, 163, 175, 0.3)",
  },
};

export const DELIVERABLE_STATUS_META: Record<
  DeliverableStatus,
  {
    label: string;
    fg: string;
    bg: string;
    border: string;
  }
> = {
  PLANNED: {
    label: "Planned",
    fg: "rgba(209, 213, 219, 1)",
    bg: "rgba(156, 163, 175, 0.15)",
    border: "rgba(156, 163, 175, 0.3)",
  },
  IN_PROGRESS: {
    label: "In Progress",
    fg: "rgba(147, 197, 253, 1)",
    bg: "rgba(59, 130, 246, 0.15)",
    border: "rgba(59, 130, 246, 0.3)",
  },
  DELIVERED: {
    label: "Delivered",
    fg: "rgba(110, 231, 183, 1)",
    bg: "rgba(52, 211, 153, 0.15)",
    border: "rgba(16, 185, 129, 0.3)",
  },
  CANCELLED: {
    label: "Cancelled",
    fg: "rgba(252, 165, 165, 1)",
    bg: "rgba(248, 113, 113, 0.15)",
    border: "rgba(248, 113, 113, 0.3)",
  },
};

export function goalRollup(
  goals: Pick<Goal, "status">[],
): {
  total: number;
  finished: number;
  blocked: number;
  inProgress: number;
  pct: number;
} {
  const total = goals.length;
  if (total === 0) {
    return {
      total: 0,
      finished: 0,
      blocked: 0,
      inProgress: 0,
      pct: 0,
    };
  }

  let finished = 0;
  let blocked = 0;
  let inProgress = 0;

  for (const goal of goals) {
    if (goal.status === "COMPLETED" || goal.status === "WONT_DO") {
      finished++;
    } else if (goal.status === "BLOCKED") {
      blocked++;
    } else if (goal.status === "IN_PROGRESS") {
      inProgress++;
    }
  }

  const pct = Math.round((finished / total) * 100);

  return {
    total,
    finished,
    blocked,
    inProgress,
    pct,
  };
}
