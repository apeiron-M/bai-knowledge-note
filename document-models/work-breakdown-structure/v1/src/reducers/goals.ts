import type { WorkBreakdownStructureGoalsOperations } from "document-models/work-breakdown-structure/v1";
import {
  DuplicateGoalIdError,
  GoalNotFoundError,
  InvalidParentError,
} from "../../gen/goals/error.js";
import { collectSubtreeIds, rebuildDepthFirst } from "../tree-utils.js";

export const workBreakdownStructureGoalsOperations: WorkBreakdownStructureGoalsOperations =
  {
    createGoalOperation(state, action) {
      if (state.goals.some((g) => g.id === action.input.id))
        throw new DuplicateGoalIdError("Goal id already exists");
      const parentId = action.input.parentId || null;
      if (parentId && !state.goals.some((g) => g.id === parentId))
        throw new GoalNotFoundError("Parent goal not found");
      let index = state.goals.length;
      if (action.input.insertBefore) {
        const i = state.goals.findIndex(
          (g) => g.id === action.input.insertBefore,
        );
        if (i === -1)
          throw new GoalNotFoundError("insertBefore goal not found");
        index = i;
      }
      state.goals.splice(index, 0, {
        id: action.input.id,
        description: action.input.description,
        status: "TODO",
        parentId,
        assignee: action.input.assignee || null,
        dependencies: [],
        blockReason: null,
        outcome: null,
        notes: [],
      });
      state.goals = rebuildDepthFirst(state.goals);
    },
    updateGoalDescriptionOperation(state, action) {
      const g = state.goals.find((g) => g.id === action.input.id);
      if (!g) throw new GoalNotFoundError("Goal not found");
      g.description = action.input.description;
    },
    deleteGoalOperation(state, action) {
      if (!state.goals.some((g) => g.id === action.input.id))
        throw new GoalNotFoundError("Goal not found");
      const removed = collectSubtreeIds(state.goals, action.input.id);
      state.goals = state.goals.filter((g) => !removed.has(g.id));
      for (const g of state.goals)
        g.dependencies = g.dependencies.filter((d) => !removed.has(d));
    },
    reorderOperation(state, action) {
      const goal = state.goals.find((g) => g.id === action.input.id);
      if (!goal) throw new GoalNotFoundError("Goal not found");
      const parentId = action.input.parentId || null;
      if (parentId) {
        if (!state.goals.some((g) => g.id === parentId))
          throw new GoalNotFoundError("Parent goal not found");
        if (
          parentId === goal.id ||
          collectSubtreeIds(state.goals, goal.id).has(parentId)
        )
          throw new InvalidParentError(
            "Cannot move a goal under itself or its descendant",
          );
      }
      goal.parentId = parentId;
      const without = state.goals.filter((g) => g.id !== goal.id);
      let index = without.length;
      if (action.input.insertBefore) {
        const i = without.findIndex(
          (g) => g.id === action.input.insertBefore,
        );
        if (i === -1)
          throw new GoalNotFoundError("insertBefore goal not found");
        index = i;
      }
      without.splice(index, 0, goal);
      state.goals = rebuildDepthFirst(without);
    },
  };
