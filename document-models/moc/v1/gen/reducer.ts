/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { createReducer, isDocumentAction } from "document-model";
import type { MocPHState } from "document-models/moc/v1";

import { mocMocManagementOperations } from "../src/reducers/moc-management.js";

import {
  AddChildMocInputSchema,
  AddCoreIdeaInputSchema,
  AddOpenQuestionInputSchema,
  AddTensionInputSchema,
  CreateMocInputSchema,
  RemoveChildMocInputSchema,
  RemoveCoreIdeaInputSchema,
  RemoveOpenQuestionInputSchema,
  RemoveTensionInputSchema,
  ReorderCoreIdeasInputSchema,
  SetMetadataFieldInputSchema,
  UpdateCoreIdeaInputSchema,
  UpdateDescriptionInputSchema,
  UpdateOrientationInputSchema,
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

const stateReducer: StateReducer<MocPHState> = (state, action, dispatch) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "CREATE_MOC": {
      memoizedSchema(CreateMocInputSchema).parse(action.input);

      mocMocManagementOperations.createMocOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_ORIENTATION": {
      memoizedSchema(UpdateOrientationInputSchema).parse(action.input);

      mocMocManagementOperations.updateOrientationOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_DESCRIPTION": {
      memoizedSchema(UpdateDescriptionInputSchema).parse(action.input);

      mocMocManagementOperations.updateDescriptionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_CORE_IDEA": {
      memoizedSchema(AddCoreIdeaInputSchema).parse(action.input);

      mocMocManagementOperations.addCoreIdeaOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_CORE_IDEA": {
      memoizedSchema(UpdateCoreIdeaInputSchema).parse(action.input);

      mocMocManagementOperations.updateCoreIdeaOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_CORE_IDEA": {
      memoizedSchema(RemoveCoreIdeaInputSchema).parse(action.input);

      mocMocManagementOperations.removeCoreIdeaOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REORDER_CORE_IDEAS": {
      memoizedSchema(ReorderCoreIdeasInputSchema).parse(action.input);

      mocMocManagementOperations.reorderCoreIdeasOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_TENSION": {
      memoizedSchema(AddTensionInputSchema).parse(action.input);

      mocMocManagementOperations.addTensionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_TENSION": {
      memoizedSchema(RemoveTensionInputSchema).parse(action.input);

      mocMocManagementOperations.removeTensionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_OPEN_QUESTION": {
      memoizedSchema(AddOpenQuestionInputSchema).parse(action.input);

      mocMocManagementOperations.addOpenQuestionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_OPEN_QUESTION": {
      memoizedSchema(RemoveOpenQuestionInputSchema).parse(action.input);

      mocMocManagementOperations.removeOpenQuestionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_CHILD_MOC": {
      memoizedSchema(AddChildMocInputSchema).parse(action.input);

      mocMocManagementOperations.addChildMocOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_CHILD_MOC": {
      memoizedSchema(RemoveChildMocInputSchema).parse(action.input);

      mocMocManagementOperations.removeChildMocOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_METADATA_FIELD": {
      memoizedSchema(SetMetadataFieldInputSchema).parse(action.input);

      mocMocManagementOperations.setMetadataFieldOperation(
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

export const reducer: Reducer<MocPHState> = createReducer(stateReducer);
