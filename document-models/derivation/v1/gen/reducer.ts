/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { createReducer, isDocumentAction } from "document-model";
import type { DerivationPHState } from "document-models/derivation/v1";

import { derivationDerivationManagementOperations } from "../src/reducers/derivation-management.js";

import {
  AddReseedEntryInputSchema,
  AddSignalInputSchema,
  InitializeDerivationInputSchema,
  UpdateDimensionRationaleInputSchema,
} from "./schema/zod.js";

const stateReducer: StateReducer<DerivationPHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "INITIALIZE_DERIVATION": {
      InitializeDerivationInputSchema().parse(action.input);

      derivationDerivationManagementOperations.initializeDerivationOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_SIGNAL": {
      AddSignalInputSchema().parse(action.input);

      derivationDerivationManagementOperations.addSignalOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_RESEED_ENTRY": {
      AddReseedEntryInputSchema().parse(action.input);

      derivationDerivationManagementOperations.addReseedEntryOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_DIMENSION_RATIONALE": {
      UpdateDimensionRationaleInputSchema().parse(action.input);

      derivationDerivationManagementOperations.updateDimensionRationaleOperation(
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

export const reducer: Reducer<DerivationPHState> = createReducer(stateReducer);
