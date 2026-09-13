import type { LintFinding, ModelRule } from "../types.js";

const bad = (
  index: number,
  field: string,
  rule: string,
  message: string,
): LintFinding => ({
  path: `actions[${index}].input.${field}`,
  rule,
  class: "REACTOR_REJECTS",
  message,
});

const negative = (value: unknown): boolean =>
  typeof value === "number" && value < 0;

export const scopeOfWorkRules: ModelRule[] = [
  (a, i) => {
    if (a.type !== "SET_DELIVERABLE_PROGRESS") return [];
    const wp = a.input.workProgress as
      | {
          percentage?: number;
          storyPoints?: { total?: number; completed?: number };
        }
      | undefined;
    const out: LintFinding[] = [];
    if (
      typeof wp?.percentage === "number" &&
      (wp.percentage < 0 || wp.percentage > 100)
    ) {
      out.push(
        bad(
          i,
          "workProgress.percentage",
          "PROGRESS_OUT_OF_RANGE",
          "percentage must be between 0 and 100",
        ),
      );
    }
    const sp = wp?.storyPoints;
    if (
      sp &&
      ((typeof sp.total === "number" && sp.total < 0) ||
        (typeof sp.completed === "number" &&
          (sp.completed < 0 ||
            (typeof sp.total === "number" && sp.completed > sp.total))))
    ) {
      out.push(
        bad(
          i,
          "workProgress.storyPoints",
          "STORY_POINTS_INVALID",
          "story points must be non-negative with completed <= total",
        ),
      );
    }
    return out;
  },
  (a, i) => {
    if (
      a.type === "SET_DELIVERABLE_BUDGET_ANCHOR_PROJECT" &&
      (negative(a.input.unitCost) ||
        negative(a.input.quantity) ||
        negative(a.input.margin))
    ) {
      return [
        bad(
          i,
          "unitCost",
          "NEGATIVE_AMOUNT",
          "budget anchor values must be zero or positive",
        ),
      ];
    }
    if (
      (a.type === "ADD_PROJECT" || a.type === "UPDATE_PROJECT") &&
      negative(a.input.budget)
    ) {
      return [
        bad(i, "budget", "NEGATIVE_AMOUNT", "budget must be zero or positive"),
      ];
    }
    if (a.type === "SET_PROJECT_MARGIN" && negative(a.input.margin)) {
      return [
        bad(i, "margin", "NEGATIVE_AMOUNT", "margin must be zero or positive"),
      ];
    }
    if (a.type === "SET_PROJECT_TOTAL_BUDGET" && negative(a.input.totalBudget)) {
      return [
        bad(
          i,
          "totalBudget",
          "NEGATIVE_AMOUNT",
          "total budget must be zero or positive",
        ),
      ];
    }
    if (
      a.type === "SET_PROJECT_EXPENDITURE" &&
      (negative(a.input.actuals) || negative(a.input.cap))
    ) {
      return [
        bad(
          i,
          "actuals",
          "NEGATIVE_AMOUNT",
          "actuals and cap must be zero or positive",
        ),
      ];
    }
    return [];
  },
  (a, i) => {
    if (a.type !== "ADD_DELIVERABLE_IN_SET") return [];
    const hasMilestone =
      a.input.milestoneId !== undefined && a.input.milestoneId !== null;
    const hasProject =
      a.input.projectId !== undefined && a.input.projectId !== null;
    return hasMilestone === hasProject
      ? [
          bad(
            i,
            "milestoneId",
            "DELIVERABLE_SET_AMBIGUOUS",
            "exactly one of milestoneId or projectId must be set",
          ),
        ]
      : [];
  },
];