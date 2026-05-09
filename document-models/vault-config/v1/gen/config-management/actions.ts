/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddExtractionCategoryInput,
  InitializeConfigInput,
  ToggleExtractionCategoryInput,
  ToggleFeatureInput,
  UpdateDimensionInput,
  UpdateMaintenanceThresholdInput,
  UpdatePipelineConfigInput,
  UpdateVocabularyInput,
} from "../types.js";

export type InitializeConfigAction = Action & {
  type: "INITIALIZE_CONFIG";
  input: InitializeConfigInput;
};
export type UpdateDimensionAction = Action & {
  type: "UPDATE_DIMENSION";
  input: UpdateDimensionInput;
};
export type UpdateVocabularyAction = Action & {
  type: "UPDATE_VOCABULARY";
  input: UpdateVocabularyInput;
};
export type UpdatePipelineConfigAction = Action & {
  type: "UPDATE_PIPELINE_CONFIG";
  input: UpdatePipelineConfigInput;
};
export type UpdateMaintenanceThresholdAction = Action & {
  type: "UPDATE_MAINTENANCE_THRESHOLD";
  input: UpdateMaintenanceThresholdInput;
};
export type AddExtractionCategoryAction = Action & {
  type: "ADD_EXTRACTION_CATEGORY";
  input: AddExtractionCategoryInput;
};
export type ToggleExtractionCategoryAction = Action & {
  type: "TOGGLE_EXTRACTION_CATEGORY";
  input: ToggleExtractionCategoryInput;
};
export type ToggleFeatureAction = Action & {
  type: "TOGGLE_FEATURE";
  input: ToggleFeatureInput;
};

export type VaultConfigConfigManagementAction =
  | InitializeConfigAction
  | UpdateDimensionAction
  | UpdateVocabularyAction
  | UpdatePipelineConfigAction
  | UpdateMaintenanceThresholdAction
  | AddExtractionCategoryAction
  | ToggleExtractionCategoryAction
  | ToggleFeatureAction;
