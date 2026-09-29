/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { createReducer, isDocumentAction } from "document-model";
import type { ResearchClaimPHState } from "document-models/research-claim/v1";

import { researchClaimClaimManagementOperations } from "../src/reducers/claim-management.js";

import {
  AddResearchConnectionInputSchema,
  CreateClaimInputSchema,
  RemoveResearchConnectionInputSchema,
  UpdateClaimContentInputSchema,
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
      memoizedSchema(CreateClaimInputSchema).parse(action.input);

      researchClaimClaimManagementOperations.createClaimOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_RESEARCH_CONNECTION": {
      memoizedSchema(AddResearchConnectionInputSchema).parse(action.input);

      researchClaimClaimManagementOperations.addResearchConnectionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_RESEARCH_CONNECTION": {
      memoizedSchema(RemoveResearchConnectionInputSchema).parse(action.input);

      researchClaimClaimManagementOperations.removeResearchConnectionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_CLAIM_CONTENT": {
      memoizedSchema(UpdateClaimContentInputSchema).parse(action.input);

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

export const reducer: Reducer<ResearchClaimPHState> =
  createReducer(stateReducer);
