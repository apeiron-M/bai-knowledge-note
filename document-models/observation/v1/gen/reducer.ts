/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { createReducer, isDocumentAction } from "document-model";
import type { ObservationPHState } from "document-models/observation/v1";

import { observationObservationManagementOperations } from "../src/reducers/observation-management.js";

import {
  ArchiveObservationInputSchema,
  CreateObservationInputSchema,
  ImplementObservationInputSchema,
  PromoteObservationInputSchema,
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
      memoizedSchema(CreateObservationInputSchema).parse(action.input);

      observationObservationManagementOperations.createObservationOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "PROMOTE_OBSERVATION": {
      memoizedSchema(PromoteObservationInputSchema).parse(action.input);

      observationObservationManagementOperations.promoteObservationOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "IMPLEMENT_OBSERVATION": {
      memoizedSchema(ImplementObservationInputSchema).parse(action.input);

      observationObservationManagementOperations.implementObservationOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ARCHIVE_OBSERVATION": {
      memoizedSchema(ArchiveObservationInputSchema).parse(action.input);

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

export const reducer: Reducer<ObservationPHState> = createReducer(stateReducer);
