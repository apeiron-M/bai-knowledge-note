import { type SignalDispatch } from "document-model";
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
import type { VaultConfigState } from "../types.js";

export interface VaultConfigConfigManagementOperations {
  initializeConfigOperation: (
    state: VaultConfigState,
    action: InitializeConfigAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateDimensionOperation: (
    state: VaultConfigState,
    action: UpdateDimensionAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateVocabularyOperation: (
    state: VaultConfigState,
    action: UpdateVocabularyAction,
    dispatch?: SignalDispatch,
  ) => void;
  updatePipelineConfigOperation: (
    state: VaultConfigState,
    action: UpdatePipelineConfigAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateMaintenanceThresholdOperation: (
    state: VaultConfigState,
    action: UpdateMaintenanceThresholdAction,
    dispatch?: SignalDispatch,
  ) => void;
  addExtractionCategoryOperation: (
    state: VaultConfigState,
    action: AddExtractionCategoryAction,
    dispatch?: SignalDispatch,
  ) => void;
  toggleExtractionCategoryOperation: (
    state: VaultConfigState,
    action: ToggleExtractionCategoryAction,
    dispatch?: SignalDispatch,
  ) => void;
  toggleFeatureOperation: (
    state: VaultConfigState,
    action: ToggleFeatureAction,
    dispatch?: SignalDispatch,
  ) => void;
}
