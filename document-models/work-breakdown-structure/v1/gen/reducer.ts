/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { createReducer, isDocumentAction } from "document-model";
import type { WorkBreakdownStructurePHState } from "document-models/work-breakdown-structure/v1";

import { workBreakdownStructureDocumentationOperations } from "../src/reducers/documentation.js";
import { workBreakdownStructureGoalsOperations } from "../src/reducers/goals.js";
import { workBreakdownStructureWorkflowOperations } from "../src/reducers/workflow.js";

import {
  AddDependenciesInputSchema,
  AddNoteInputSchema,
  AssignGoalInputSchema,
  CreateGoalInputSchema,
  DeleteGoalInputSchema,
  RemoveDependenciesInputSchema,
  RemoveNoteInputSchema,
  ReorderInputSchema,
  SetGoalStatusInputSchema,
  SetOutcomeInputSchema,
  SetOwnerInputSchema,
  SetProjectRefInputSchema,
  SetReferencesInputSchema,
  UpdateGoalDescriptionInputSchema,
} from "./schema/zod.js";

const stateReducer: StateReducer<WorkBreakdownStructurePHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "CREATE_GOAL": {
      CreateGoalInputSchema().parse(action.input);

      workBreakdownStructureGoalsOperations.createGoalOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_GOAL_DESCRIPTION": {
      UpdateGoalDescriptionInputSchema().parse(action.input);

      workBreakdownStructureGoalsOperations.updateGoalDescriptionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "DELETE_GOAL": {
      DeleteGoalInputSchema().parse(action.input);

      workBreakdownStructureGoalsOperations.deleteGoalOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REORDER": {
      ReorderInputSchema().parse(action.input);

      workBreakdownStructureGoalsOperations.reorderOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_GOAL_STATUS": {
      SetGoalStatusInputSchema().parse(action.input);

      workBreakdownStructureWorkflowOperations.setGoalStatusOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ASSIGN_GOAL": {
      AssignGoalInputSchema().parse(action.input);

      workBreakdownStructureWorkflowOperations.assignGoalOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_OUTCOME": {
      SetOutcomeInputSchema().parse(action.input);

      workBreakdownStructureWorkflowOperations.setOutcomeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_DEPENDENCIES": {
      AddDependenciesInputSchema().parse(action.input);

      workBreakdownStructureWorkflowOperations.addDependenciesOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_DEPENDENCIES": {
      RemoveDependenciesInputSchema().parse(action.input);

      workBreakdownStructureWorkflowOperations.removeDependenciesOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_NOTE": {
      AddNoteInputSchema().parse(action.input);

      workBreakdownStructureDocumentationOperations.addNoteOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_NOTE": {
      RemoveNoteInputSchema().parse(action.input);

      workBreakdownStructureDocumentationOperations.removeNoteOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_OWNER": {
      SetOwnerInputSchema().parse(action.input);

      workBreakdownStructureDocumentationOperations.setOwnerOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_REFERENCES": {
      SetReferencesInputSchema().parse(action.input);

      workBreakdownStructureDocumentationOperations.setReferencesOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_PROJECT_REF": {
      SetProjectRefInputSchema().parse(action.input);

      workBreakdownStructureDocumentationOperations.setProjectRefOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    default:
      return state;
  }
};

export const reducer: Reducer<WorkBreakdownStructurePHState> =
  createReducer(stateReducer);
