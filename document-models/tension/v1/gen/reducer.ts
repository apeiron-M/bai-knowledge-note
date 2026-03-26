// TODO: remove eslint-disable rules once refactor is done
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { StateReducer } from "document-model";
import { isDocumentAction, createReducer } from "document-model/core";
import type { TensionPHState } from "knowledge-note/document-models/tension/v1";

import { tensionTensionManagementOperations } from "../src/reducers/tension-management.js";

import {
  CreateTensionInputSchema,
  ResolveTensionInputSchema,
  DissolveTensionInputSchema,
  AddInvolvedRefInputSchema,
} from "./schema/zod.js";

const stateReducer: StateReducer<TensionPHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "CREATE_TENSION": {
      CreateTensionInputSchema().parse(action.input);

      tensionTensionManagementOperations.createTensionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "RESOLVE_TENSION": {
      ResolveTensionInputSchema().parse(action.input);

      tensionTensionManagementOperations.resolveTensionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "DISSOLVE_TENSION": {
      DissolveTensionInputSchema().parse(action.input);

      tensionTensionManagementOperations.dissolveTensionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_INVOLVED_REF": {
      AddInvolvedRefInputSchema().parse(action.input);

      tensionTensionManagementOperations.addInvolvedRefOperation(
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

export const reducer = createReducer<TensionPHState>(stateReducer);
