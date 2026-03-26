// TODO: remove eslint-disable rules once refactor is done
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { StateReducer } from "document-model";
import { isDocumentAction, createReducer } from "document-model/core";
import type { ResearchClaimPHState } from "knowledge-note/document-models/research-claim/v1";

import { researchClaimClaimManagementOperations } from "../src/reducers/claim-management.js";

import {
  CreateClaimInputSchema,
  AddResearchConnectionInputSchema,
  RemoveResearchConnectionInputSchema,
  UpdateClaimContentInputSchema,
} from "./schema/zod.js";

const stateReducer: StateReducer<ResearchClaimPHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "CREATE_CLAIM": {
      CreateClaimInputSchema().parse(action.input);

      researchClaimClaimManagementOperations.createClaimOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_RESEARCH_CONNECTION": {
      AddResearchConnectionInputSchema().parse(action.input);

      researchClaimClaimManagementOperations.addResearchConnectionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_RESEARCH_CONNECTION": {
      RemoveResearchConnectionInputSchema().parse(action.input);

      researchClaimClaimManagementOperations.removeResearchConnectionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_CLAIM_CONTENT": {
      UpdateClaimContentInputSchema().parse(action.input);

      researchClaimClaimManagementOperations.updateClaimContentOperation(
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

export const reducer = createReducer<ResearchClaimPHState>(stateReducer);
