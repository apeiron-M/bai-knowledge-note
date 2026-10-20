/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { createReducer, isDocumentAction } from "document-model";
import type { VaultConfigPHState } from "document-models/vault-config/v1";

import { vaultConfigConfigManagementOperations } from "../src/reducers/config-management.js";

import {
  AddExtractionCategoryInputSchema,
  InitializeConfigInputSchema,
  ToggleExtractionCategoryInputSchema,
  ToggleFeatureInputSchema,
  UpdateDimensionInputSchema,
  UpdateMaintenanceThresholdInputSchema,
  UpdatePipelineConfigInputSchema,
  UpdateVocabularyInputSchema,
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

const stateReducer: StateReducer<VaultConfigPHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "INITIALIZE_CONFIG": {
      memoizedSchema(InitializeConfigInputSchema).parse(action.input);

      vaultConfigConfigManagementOperations.initializeConfigOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_DIMENSION": {
      memoizedSchema(UpdateDimensionInputSchema).parse(action.input);

      vaultConfigConfigManagementOperations.updateDimensionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_VOCABULARY": {
      memoizedSchema(UpdateVocabularyInputSchema).parse(action.input);

      vaultConfigConfigManagementOperations.updateVocabularyOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_PIPELINE_CONFIG": {
      memoizedSchema(UpdatePipelineConfigInputSchema).parse(action.input);

      vaultConfigConfigManagementOperations.updatePipelineConfigOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_MAINTENANCE_THRESHOLD": {
      memoizedSchema(UpdateMaintenanceThresholdInputSchema).parse(action.input);

      vaultConfigConfigManagementOperations.updateMaintenanceThresholdOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_EXTRACTION_CATEGORY": {
      memoizedSchema(AddExtractionCategoryInputSchema).parse(action.input);

      vaultConfigConfigManagementOperations.addExtractionCategoryOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "TOGGLE_EXTRACTION_CATEGORY": {
      memoizedSchema(ToggleExtractionCategoryInputSchema).parse(action.input);

      vaultConfigConfigManagementOperations.toggleExtractionCategoryOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "TOGGLE_FEATURE": {
      memoizedSchema(ToggleFeatureInputSchema).parse(action.input);

      vaultConfigConfigManagementOperations.toggleFeatureOperation(
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

export const reducer: Reducer<VaultConfigPHState> = createReducer(stateReducer);
