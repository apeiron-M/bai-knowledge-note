import type { VaultConfigConfigManagementOperations } from "document-models/vault-config/v1";

export const vaultConfigConfigManagementOperations: VaultConfigConfigManagementOperations =
  {
    initializeConfigOperation(state, action) {
      state.name = action.input.name;
      state.domain = action.input.domain;
      state.updatedAt = action.input.updatedAt;
    },
    updateDimensionOperation(state, action) {
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
      const DIMENSION_KEYS = [
        "granularity",
        "organization",
        "linking",
        "processing",
        "navigation",
        "maintenance",
        "schema",
        "automation",
      ] as const;
      const dim = DIMENSION_KEYS.find((k) => k === action.input.dimension);
      if (dim) {
        state.dimensions[dim] = {
          value: action.input.value,
          confidence: action.input.confidence,
          rationale: action.input.rationale || null,
        };
      }
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
      const VOCABULARY_KEYS = [
        "notes",
        "inbox",
        "reduce",
        "reflect",
        "reweave",
        "verify",
        "rethink",
        "topicMap",
        "description",
      ] as const;
      const key = VOCABULARY_KEYS.find((k) => k === action.input.key);
      if (key) {
        state.vocabulary[key] = action.input.value;
      }
      state.updatedAt = action.input.updatedAt;
    },
    updatePipelineConfigOperation(state, action) {
      if (!state.pipeline)
        state.pipeline = {
          depth: "standard",
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
      const MAINTENANCE_KEYS = [
        "orphanThreshold",
        "danglingThreshold",
        "inboxPressure",
        "observationAccumulation",
        "tensionAccumulation",
        "mocOversize",
        "staleNoteDays",
      ] as const;
      const condition = MAINTENANCE_KEYS.find(
        (k) => k === action.input.condition,
      );
      if (condition) {
        state.maintenance[condition] = action.input.threshold;
      }
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
