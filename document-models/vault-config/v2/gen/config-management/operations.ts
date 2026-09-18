/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { VaultConfigGlobalState } from "../types.js";
import type {
  AddExtractionCategoryAction,
  InitializeConfigAction,
  ToggleExtractionCategoryAction,
  ToggleFeatureAction,
  UpdateDimensionAction,
  UpdateMaintenanceThresholdAction,
  UpdatePipelineConfigAction,
  UpdateVocabularyAction,
} from "./actions.js";

export interface VaultConfigConfigManagementOperations {
  initializeConfigOperation: (
    state: VaultConfigGlobalState,
    action: InitializeConfigAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateDimensionOperation: (
    state: VaultConfigGlobalState,
    action: UpdateDimensionAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateVocabularyOperation: (
    state: VaultConfigGlobalState,
    action: UpdateVocabularyAction,
    dispatch?: SignalDispatch,
  ) => void;
  updatePipelineConfigOperation: (
    state: VaultConfigGlobalState,
    action: UpdatePipelineConfigAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateMaintenanceThresholdOperation: (
    state: VaultConfigGlobalState,
    action: UpdateMaintenanceThresholdAction,
    dispatch?: SignalDispatch,
  ) => void;
  addExtractionCategoryOperation: (
    state: VaultConfigGlobalState,
    action: AddExtractionCategoryAction,
    dispatch?: SignalDispatch,
  ) => void;
  toggleExtractionCategoryOperation: (
    state: VaultConfigGlobalState,
    action: ToggleExtractionCategoryAction,
    dispatch?: SignalDispatch,
  ) => void;
  toggleFeatureOperation: (
    state: VaultConfigGlobalState,
    action: ToggleFeatureAction,
    dispatch?: SignalDispatch,
  ) => void;
}
