import type {
  Dimension,
  DimensionConfig,
  MaintenanceCondition,
  MaintenanceConfig,
  VaultConfigConfigManagementOperations,
  VocabularyKey,
  VocabularyMap,
} from "document-models/vault-config/v1";
import {
  InvalidDimensionValueError,
  InvalidPipelineConfigError,
  InvalidThresholdError,
} from "../../gen/config-management/error.js";

// The input enums map onto state keys through these tables. Because the
// inputs are enums, an unknown key is rejected by input validation before the
// reducer runs — the old "silently ignore, still bump updatedAt" branch is gone.
const DIMENSION_KEYS: Record<Dimension, keyof DimensionConfig> = {
  GRANULARITY: "granularity",
  ORGANIZATION: "organization",
  LINKING: "linking",
  PROCESSING: "processing",
  NAVIGATION: "navigation",
  MAINTENANCE: "maintenance",
  SCHEMA: "schema",
  AUTOMATION: "automation",
};
const VOCABULARY_KEYS: Record<VocabularyKey, keyof VocabularyMap> = {
  NOTES: "notes",
  INBOX: "inbox",
  REDUCE: "reduce",
  REFLECT: "reflect",
  REWEAVE: "reweave",
  VERIFY: "verify",
  RETHINK: "rethink",
  TOPIC_MAP: "topicMap",
  DESCRIPTION: "description",
};
const MAINTENANCE_KEYS: Record<MaintenanceCondition, keyof MaintenanceConfig> =
  {
    ORPHAN_THRESHOLD: "orphanThreshold",
    DANGLING_THRESHOLD: "danglingThreshold",
    INBOX_PRESSURE: "inboxPressure",
    OBSERVATION_ACCUMULATION: "observationAccumulation",
    TENSION_ACCUMULATION: "tensionAccumulation",
    MOC_OVERSIZE: "mocOversize",
    STALE_NOTE_DAYS: "staleNoteDays",
  };

export const vaultConfigConfigManagementOperations: VaultConfigConfigManagementOperations =
  {
    initializeConfigOperation(state, action) {
      state.name = action.input.name;
      state.domain = action.input.domain;
      state.updatedAt = action.input.updatedAt;
    },
    updateDimensionOperation(state, action) {
      if (action.input.value < 1 || action.input.value > 5) {
        throw new InvalidDimensionValueError(
          `Dimension position must be within 1..5, got ${action.input.value}`,
        );
      }
      if (action.input.confidence < 0 || action.input.confidence > 1) {
        throw new InvalidDimensionValueError(
          `Dimension confidence must be within 0..1, got ${action.input.confidence}`,
        );
      }
      if (!state.dimensions)
        state.dimensions = {
          granularity: { value: 3, confidence: 0.5, rationale: null },
          organization: { value: 3, confidence: 0.5, rationale: null },
          linking: { value: 3, confidence: 0.5, rationale: null },
          processing: { value: 3, confidence: 0.5, rationale: null },
          navigation: { value: 3, confidence: 0.5, rationale: null },
          maintenance: { value: 3, confidence: 0.5, rationale: null },
          schema: { value: 3, confidence: 0.5, rationale: null },
          automation: { value: 3, confidence: 0.5, rationale: null },
        };
      state.dimensions[DIMENSION_KEYS[action.input.dimension]] = {
        value: action.input.value,
        confidence: action.input.confidence,
        rationale: action.input.rationale || null,
      };
      state.updatedAt = action.input.updatedAt;
    },
    updateVocabularyOperation(state, action) {
      if (!state.vocabulary)
        state.vocabulary = {
          notes: "notes",
          inbox: "inbox",
          reduce: "reduce",
          reflect: "reflect",
          reweave: "reweave",
          verify: "verify",
          rethink: "rethink",
          topicMap: "topic map",
          description: "description",
        };
      state.vocabulary[VOCABULARY_KEYS[action.input.key]] = action.input.value;
      state.updatedAt = action.input.updatedAt;
    },
    updatePipelineConfigOperation(state, action) {
      if (
        action.input.extractionSelectivity !== undefined &&
        action.input.extractionSelectivity !== null &&
        (action.input.extractionSelectivity < 0 ||
          action.input.extractionSelectivity > 1)
      ) {
        throw new InvalidPipelineConfigError(
          `extractionSelectivity must be within 0..1, got ${action.input.extractionSelectivity}`,
        );
      }
      if (!state.pipeline)
        state.pipeline = {
          depth: "STANDARD",
          autoChain: false,
          extractionSelectivity: 0.1,
        };
      if (action.input.depth) state.pipeline.depth = action.input.depth;
      if (
        action.input.autoChain !== undefined &&
        action.input.autoChain !== null
      )
        state.pipeline.autoChain = action.input.autoChain;
      if (
        action.input.extractionSelectivity !== undefined &&
        action.input.extractionSelectivity !== null
      )
        state.pipeline.extractionSelectivity =
          action.input.extractionSelectivity;
      state.updatedAt = action.input.updatedAt;
    },
    updateMaintenanceThresholdOperation(state, action) {
      if (action.input.threshold < 0) {
        throw new InvalidThresholdError(
          `A maintenance threshold cannot be negative, got ${action.input.threshold}`,
        );
      }
      if (!state.maintenance)
        state.maintenance = {
          orphanThreshold: 1,
          danglingThreshold: 1,
          inboxPressure: 5,
          observationAccumulation: 10,
          tensionAccumulation: 5,
          mocOversize: 40,
          staleNoteDays: 30,
        };
      state.maintenance[MAINTENANCE_KEYS[action.input.condition]] =
        action.input.threshold;
      state.updatedAt = action.input.updatedAt;
    },
    addExtractionCategoryOperation(state, action) {
      state.extractionCategories.push({
        id: action.input.id,
        name: action.input.name,
        description: action.input.description,
        active: action.input.active,
      });
    },
    toggleExtractionCategoryOperation(state, action) {
      const cat = state.extractionCategories.find(
        (c) => c.id === action.input.id,
      );
      if (cat) cat.active = action.input.active;
    },
    toggleFeatureOperation(state, action) {
      if (
        action.input.enabled &&
        !state.features.includes(action.input.feature)
      ) {
        state.features.push(action.input.feature);
      } else if (!action.input.enabled) {
        state.features = state.features.filter(
          (f) => f !== action.input.feature,
        );
      }
    },
  };
