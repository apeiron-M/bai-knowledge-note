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
  SetSowProjectRefInputSchema,
  UpdateGoalDescriptionInputSchema,
} from "./schema/zod.js";

const schemaMemo = new Map<() => unknown, unknown>();

function memoizedSchema<T>(makeSchema: () => T): T {
  let schema = schemaMemo.get(makeSchema) as T | undefined;
  if (schema === undefined) {
    schema = makeSchema();
    schemaMemo.set(makeSchema, schema);
  }
  return schema;
}

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
      memoizedSchema(CreateGoalInputSchema).parse(action.input);

      workBreakdownStructureGoalsOperations.createGoalOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_GOAL_DESCRIPTION": {
      memoizedSchema(UpdateGoalDescriptionInputSchema).parse(action.input);

      workBreakdownStructureGoalsOperations.updateGoalDescriptionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "DELETE_GOAL": {
      memoizedSchema(DeleteGoalInputSchema).parse(action.input);

      workBreakdownStructureGoalsOperations.deleteGoalOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REORDER": {
      memoizedSchema(ReorderInputSchema).parse(action.input);

      workBreakdownStructureGoalsOperations.reorderOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_GOAL_STATUS": {
      memoizedSchema(SetGoalStatusInputSchema).parse(action.input);

      workBreakdownStructureWorkflowOperations.setGoalStatusOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ASSIGN_GOAL": {
      memoizedSchema(AssignGoalInputSchema).parse(action.input);

      workBreakdownStructureWorkflowOperations.assignGoalOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_OUTCOME": {
      memoizedSchema(SetOutcomeInputSchema).parse(action.input);

      workBreakdownStructureWorkflowOperations.setOutcomeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_DEPENDENCIES": {
      memoizedSchema(AddDependenciesInputSchema).parse(action.input);

      workBreakdownStructureWorkflowOperations.addDependenciesOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_DEPENDENCIES": {
      memoizedSchema(RemoveDependenciesInputSchema).parse(action.input);

      workBreakdownStructureWorkflowOperations.removeDependenciesOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_NOTE": {
      memoizedSchema(AddNoteInputSchema).parse(action.input);

      workBreakdownStructureDocumentationOperations.addNoteOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_NOTE": {
      memoizedSchema(RemoveNoteInputSchema).parse(action.input);

      workBreakdownStructureDocumentationOperations.removeNoteOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_OWNER": {
      memoizedSchema(SetOwnerInputSchema).parse(action.input);

      workBreakdownStructureDocumentationOperations.setOwnerOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_REFERENCES": {
      memoizedSchema(SetReferencesInputSchema).parse(action.input);

      workBreakdownStructureDocumentationOperations.setReferencesOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_PROJECT_REF": {
      memoizedSchema(SetProjectRefInputSchema).parse(action.input);

      workBreakdownStructureDocumentationOperations.setProjectRefOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_SOW_PROJECT_REF": {
      memoizedSchema(SetSowProjectRefInputSchema).parse(action.input);

      workBreakdownStructureDocumentationOperations.setSowProjectRefOperation(
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
