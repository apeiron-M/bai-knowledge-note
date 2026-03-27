// TODO: remove eslint-disable rules once refactor is done
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { StateReducer } from "document-model";
import { isDocumentAction, createReducer } from "document-model/core";
import type { DerivationPHState } from "@powerhousedao/knowledge-note/document-models/derivation/v1";

import { derivationDerivationManagementOperations } from "../src/reducers/derivation-management.js";

import {
  InitializeDerivationInputSchema,
  AddSignalInputSchema,
  AddReseedEntryInputSchema,
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

export const reducer = createReducer<DerivationPHState>(stateReducer);
