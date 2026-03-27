// TODO: remove eslint-disable rules once refactor is done
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { StateReducer } from "document-model";
import { isDocumentAction, createReducer } from "document-model/core";
import type { ObservationPHState } from "@powerhousedao/knowledge-note/document-models/observation/v1";

import { observationObservationManagementOperations } from "../src/reducers/observation-management.js";

import {
  CreateObservationInputSchema,
  PromoteObservationInputSchema,
  ImplementObservationInputSchema,
  ArchiveObservationInputSchema,
} from "./schema/zod.js";

const stateReducer: StateReducer<ObservationPHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "CREATE_OBSERVATION": {
      CreateObservationInputSchema().parse(action.input);

      observationObservationManagementOperations.createObservationOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "PROMOTE_OBSERVATION": {
      PromoteObservationInputSchema().parse(action.input);

      observationObservationManagementOperations.promoteObservationOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "IMPLEMENT_OBSERVATION": {
      ImplementObservationInputSchema().parse(action.input);

      observationObservationManagementOperations.implementObservationOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ARCHIVE_OBSERVATION": {
      ArchiveObservationInputSchema().parse(action.input);

      observationObservationManagementOperations.archiveObservationOperation(
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

export const reducer = createReducer<ObservationPHState>(stateReducer);
