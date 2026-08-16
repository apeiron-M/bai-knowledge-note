import type { WorkBreakdownStructureWorkflowOperations } from "document-models/work-breakdown-structure/v1";
import {
  DependencyNotFoundError,
  GoalNotFoundError,
  InvalidDependencyError,
  MissingBlockReasonError,
} from "../../gen/workflow/error.js";

export const workBreakdownStructureWorkflowOperations: WorkBreakdownStructureWorkflowOperations =
  {
    setGoalStatusOperation(state, action) {
      const g = state.goals.find((g) => g.id === action.input.id);
      if (!g) throw new GoalNotFoundError("Goal not found");
      if (
        action.input.status === "BLOCKED" &&
        !action.input.blockReason?.trim()
      )
        throw new MissingBlockReasonError("BLOCKED requires a blockReason");
      g.status = action.input.status;
      g.blockReason =
        action.input.status === "BLOCKED"
          ? (action.input.blockReason ?? null)
          : null;
      if (action.input.outcome) g.outcome = action.input.outcome;
    },
    assignGoalOperation(state, action) {
      const g = state.goals.find((g) => g.id === action.input.id);
      if (!g) throw new GoalNotFoundError("Goal not found");
      g.assignee = action.input.assignee || null;
    },
    setOutcomeOperation(state, action) {
      const g = state.goals.find((g) => g.id === action.input.id);
      if (!g) throw new GoalNotFoundError("Goal not found");
      g.outcome = action.input.outcome || null;
    },
    addDependenciesOperation(state, action) {
      const g = state.goals.find((g) => g.id === action.input.id);
      if (!g) throw new GoalNotFoundError("Goal not found");
      for (const dep of action.input.dependencies) {
        if (dep === g.id)
          throw new InvalidDependencyError("Goal cannot depend on itself");
        if (!state.goals.some((o) => o.id === dep))
          throw new DependencyNotFoundError("Dependency goal not found");
      }
      for (const dep of action.input.dependencies)
        if (!g.dependencies.includes(dep)) g.dependencies.push(dep);
    },
    removeDependenciesOperation(state, action) {
      const g = state.goals.find((g) => g.id === action.input.id);
      if (!g) throw new GoalNotFoundError("Goal not found");
      g.dependencies = g.dependencies.filter(
        (d) => !action.input.dependencies.includes(d),
      );
    },
  };
