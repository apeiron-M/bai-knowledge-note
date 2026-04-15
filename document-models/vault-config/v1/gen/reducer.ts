/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { isDocumentAction, createReducer } from "document-model";
import type { VaultConfigPHState } from "document-models/vault-config/v1";

import { vaultConfigConfigManagementOperations } from "../src/reducers/config-management.js";

import {
  InitializeConfigInputSchema,
  UpdateDimensionInputSchema,
  UpdateVocabularyInputSchema,
  UpdatePipelineConfigInputSchema,
  UpdateMaintenanceThresholdInputSchema,
  AddExtractionCategoryInputSchema,
  ToggleExtractionCategoryInputSchema,
  ToggleFeatureInputSchema,
} from "./schema/zod.js";

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
      InitializeConfigInputSchema().parse(action.input);

      vaultConfigConfigManagementOperations.initializeConfigOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_DIMENSION": {
      UpdateDimensionInputSchema().parse(action.input);

      vaultConfigConfigManagementOperations.updateDimensionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_VOCABULARY": {
      UpdateVocabularyInputSchema().parse(action.input);

      vaultConfigConfigManagementOperations.updateVocabularyOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_PIPELINE_CONFIG": {
      UpdatePipelineConfigInputSchema().parse(action.input);

      vaultConfigConfigManagementOperations.updatePipelineConfigOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_MAINTENANCE_THRESHOLD": {
      UpdateMaintenanceThresholdInputSchema().parse(action.input);

      vaultConfigConfigManagementOperations.updateMaintenanceThresholdOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_EXTRACTION_CATEGORY": {
      AddExtractionCategoryInputSchema().parse(action.input);

      vaultConfigConfigManagementOperations.addExtractionCategoryOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "TOGGLE_EXTRACTION_CATEGORY": {
      ToggleExtractionCategoryInputSchema().parse(action.input);

      vaultConfigConfigManagementOperations.toggleExtractionCategoryOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "TOGGLE_FEATURE": {
      ToggleFeatureInputSchema().parse(action.input);

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
