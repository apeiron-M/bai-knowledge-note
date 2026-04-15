/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { isDocumentAction, createReducer } from "document-model";
import type { SourcePHState } from "document-models/source/v1";

import { sourceSourceManagementOperations } from "../src/reducers/source-management.js";

import {
  IngestSourceInputSchema,
  SetSourceStatusInputSchema,
  AddExtractedClaimInputSchema,
  RecordExtractionStatsInputSchema,
} from "./schema/zod.js";

const stateReducer: StateReducer<SourcePHState> = (state, action, dispatch) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "INGEST_SOURCE": {
      IngestSourceInputSchema().parse(action.input);

      sourceSourceManagementOperations.ingestSourceOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_SOURCE_STATUS": {
      SetSourceStatusInputSchema().parse(action.input);

      sourceSourceManagementOperations.setSourceStatusOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_EXTRACTED_CLAIM": {
      AddExtractedClaimInputSchema().parse(action.input);

      sourceSourceManagementOperations.addExtractedClaimOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "RECORD_EXTRACTION_STATS": {
      RecordExtractionStatsInputSchema().parse(action.input);

      sourceSourceManagementOperations.recordExtractionStatsOperation(
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

export const reducer: Reducer<SourcePHState> = createReducer(stateReducer);
