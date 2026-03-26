import { createAction } from "document-model/core";
import {
  InitializeConfigInputSchema,
  UpdateDimensionInputSchema,
  UpdateVocabularyInputSchema,
  UpdatePipelineConfigInputSchema,
  UpdateMaintenanceThresholdInputSchema,
  AddExtractionCategoryInputSchema,
  ToggleExtractionCategoryInputSchema,
  ToggleFeatureInputSchema,
} from "../schema/zod.js";
import type {
  InitializeConfigInput,
  UpdateDimensionInput,
  UpdateVocabularyInput,
  UpdatePipelineConfigInput,
  UpdateMaintenanceThresholdInput,
  AddExtractionCategoryInput,
  ToggleExtractionCategoryInput,
  ToggleFeatureInput,
} from "../types.js";
import type {
  InitializeConfigAction,
  UpdateDimensionAction,
  UpdateVocabularyAction,
  UpdatePipelineConfigAction,
  UpdateMaintenanceThresholdAction,
  AddExtractionCategoryAction,
  ToggleExtractionCategoryAction,
  ToggleFeatureAction,
} from "./actions.js";

export const initializeConfig = (input: InitializeConfigInput) =>
  createAction<InitializeConfigAction>(
    "INITIALIZE_CONFIG",
    { ...input },
    undefined,
    InitializeConfigInputSchema,
    "global",
  );

export const updateDimension = (input: UpdateDimensionInput) =>
  createAction<UpdateDimensionAction>(
    "UPDATE_DIMENSION",
    { ...input },
    undefined,
    UpdateDimensionInputSchema,
    "global",
  );

export const updateVocabulary = (input: UpdateVocabularyInput) =>
  createAction<UpdateVocabularyAction>(
    "UPDATE_VOCABULARY",
    { ...input },
    undefined,
    UpdateVocabularyInputSchema,
    "global",
  );

export const updatePipelineConfig = (input: UpdatePipelineConfigInput) =>
  createAction<UpdatePipelineConfigAction>(
    "UPDATE_PIPELINE_CONFIG",
    { ...input },
    undefined,
    UpdatePipelineConfigInputSchema,
    "global",
  );

export const updateMaintenanceThreshold = (
  input: UpdateMaintenanceThresholdInput,
) =>
  createAction<UpdateMaintenanceThresholdAction>(
    "UPDATE_MAINTENANCE_THRESHOLD",
    { ...input },
    undefined,
    UpdateMaintenanceThresholdInputSchema,
    "global",
  );

export const addExtractionCategory = (input: AddExtractionCategoryInput) =>
  createAction<AddExtractionCategoryAction>(
    "ADD_EXTRACTION_CATEGORY",
    { ...input },
    undefined,
    AddExtractionCategoryInputSchema,
    "global",
  );

export const toggleExtractionCategory = (
  input: ToggleExtractionCategoryInput,
) =>
  createAction<ToggleExtractionCategoryAction>(
    "TOGGLE_EXTRACTION_CATEGORY",
    { ...input },
    undefined,
    ToggleExtractionCategoryInputSchema,
    "global",
  );

export const toggleFeature = (input: ToggleFeatureInput) =>
  createAction<ToggleFeatureAction>(
    "TOGGLE_FEATURE",
    { ...input },
    undefined,
    ToggleFeatureInputSchema,
    "global",
  );
