// TODO: remove eslint-disable rules once refactor is done
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { StateReducer } from "document-model";
import { isDocumentAction, createReducer } from "document-model/core";
import type { MocPHState } from "knowledge-note/document-models/moc/v1";

import { mocMocManagementOperations } from "../src/reducers/moc-management.js";

import {
  CreateMocInputSchema,
  UpdateOrientationInputSchema,
  UpdateDescriptionInputSchema,
  AddCoreIdeaInputSchema,
  UpdateCoreIdeaInputSchema,
  RemoveCoreIdeaInputSchema,
  ReorderCoreIdeasInputSchema,
  AddTensionInputSchema,
  RemoveTensionInputSchema,
  AddOpenQuestionInputSchema,
  RemoveOpenQuestionInputSchema,
  AddChildMocInputSchema,
  RemoveChildMocInputSchema,
} from "./schema/zod.js";

const stateReducer: StateReducer<MocPHState> = (state, action, dispatch) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "CREATE_MOC": {
      CreateMocInputSchema().parse(action.input);

      mocMocManagementOperations.createMocOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_ORIENTATION": {
      UpdateOrientationInputSchema().parse(action.input);

      mocMocManagementOperations.updateOrientationOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_DESCRIPTION": {
      UpdateDescriptionInputSchema().parse(action.input);

      mocMocManagementOperations.updateDescriptionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_CORE_IDEA": {
      AddCoreIdeaInputSchema().parse(action.input);

      mocMocManagementOperations.addCoreIdeaOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_CORE_IDEA": {
      UpdateCoreIdeaInputSchema().parse(action.input);

      mocMocManagementOperations.updateCoreIdeaOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_CORE_IDEA": {
      RemoveCoreIdeaInputSchema().parse(action.input);

      mocMocManagementOperations.removeCoreIdeaOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REORDER_CORE_IDEAS": {
      ReorderCoreIdeasInputSchema().parse(action.input);

      mocMocManagementOperations.reorderCoreIdeasOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_TENSION": {
      AddTensionInputSchema().parse(action.input);

      mocMocManagementOperations.addTensionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_TENSION": {
      RemoveTensionInputSchema().parse(action.input);

      mocMocManagementOperations.removeTensionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_OPEN_QUESTION": {
      AddOpenQuestionInputSchema().parse(action.input);

      mocMocManagementOperations.addOpenQuestionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_OPEN_QUESTION": {
      RemoveOpenQuestionInputSchema().parse(action.input);

      mocMocManagementOperations.removeOpenQuestionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_CHILD_MOC": {
      AddChildMocInputSchema().parse(action.input);

      mocMocManagementOperations.addChildMocOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_CHILD_MOC": {
      RemoveChildMocInputSchema().parse(action.input);

      mocMocManagementOperations.removeChildMocOperation(
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

export const reducer = createReducer<MocPHState>(stateReducer);
