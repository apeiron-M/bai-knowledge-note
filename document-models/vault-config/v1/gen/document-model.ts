import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  id: "bai/vault-config",
  name: "VaultConfig",
  author: {
    name: "BAI",
    website: "https://bai.powerhouse.io/",
  },
  extension: "",
  description:
    "Live vault configuration \u2014 singleton document controlling the 8-dimension parameter space, vocabulary mapping, pipeline settings, and maintenance thresholds.",
  specifications: [
    {
      state: {
        local: {
          schema: "",
          examples: [],
          initialValue: "",
        },
        global: {
          schema:
            "type DimensionPosition {\n    value: Int!\n    confidence: Float!\n    rationale: String\n}\n\ntype DimensionConfig {\n    granularity: DimensionPosition!\n    organization: DimensionPosition!\n    linking: DimensionPosition!\n    processing: DimensionPosition!\n    navigation: DimensionPosition!\n    maintenance: DimensionPosition!\n    schema: DimensionPosition!\n    automation: DimensionPosition!\n}\n\ntype VocabularyMap {\n    notes: String!\n    inbox: String!\n    reduce: String!\n    reflect: String!\n    reweave: String!\n    verify: String!\n    rethink: String!\n    topicMap: String!\n    description: String!\n}\n\ntype PipelineConfig {\n    depth: String!\n    autoChain: Boolean!\n    extractionSelectivity: Float!\n}\n\ntype MaintenanceConfig {\n    orphanThreshold: Int!\n    danglingThreshold: Int!\n    inboxPressure: Int!\n    observationAccumulation: Int!\n    tensionAccumulation: Int!\n    mocOversize: Int!\n    staleNoteDays: Int!\n}\n\ntype ExtractionCategory {\n    id: OID!\n    name: String!\n    description: String!\n    active: Boolean!\n}\n\ntype NoteSchemaConfig {\n    requiredFields: [String!]!\n    optionalFields: [String!]!\n    kindValues: [String!]!\n    confidenceValues: [String!]!\n}\n\ntype MocSchemaConfig {\n    requiredFields: [String!]!\n    tierValues: [String!]!\n}\n\ntype VaultConfigState {\n    name: String\n    domain: String\n    dimensions: DimensionConfig\n    vocabulary: VocabularyMap\n    features: [String!]!\n    pipeline: PipelineConfig\n    maintenance: MaintenanceConfig\n    extractionCategories: [ExtractionCategory!]!\n    noteSchema: NoteSchemaConfig\n    mocSchema: MocSchemaConfig\n    updatedAt: DateTime\n}",
          examples: [],
          initialValue:
            '{\n    "name": null,\n    "domain": null,\n    "dimensions": null,\n    "vocabulary": null,\n    "features": [],\n    "pipeline": null,\n    "maintenance": null,\n    "extractionCategories": [],\n    "noteSchema": null,\n    "mocSchema": null,\n    "updatedAt": null\n}',
        },
      },
      modules: [
        {
          id: "config-management",
          name: "config-management",
          operations: [
            {
              id: "initialize-config",
              name: "INITIALIZE_CONFIG",
              scope: "global",
              errors: [],
              schema:
                "input InitializeConfigInput {\n    name: String!\n    domain: String!\n    updatedAt: DateTime!\n}",
              reducer:
                "state.name = action.input.name;\nstate.domain = action.input.domain;\nstate.updatedAt = action.input.updatedAt;",
              examples: [],
              template: "Initialize vault configuration with name and domain",
              description:
                "Initialize vault configuration with name and domain",
            },
            {
              id: "update-dimension",
              name: "UPDATE_DIMENSION",
              scope: "global",
              errors: [],
              schema:
                "input UpdateDimensionInput {\n    dimension: String!\n    value: Int!\n    confidence: Float!\n    rationale: String\n    updatedAt: DateTime!\n}",
              reducer:
                "if (!state.dimensions) state.dimensions = {\n    granularity: { value: 3, confidence: 0.5, rationale: null },\n    organization: { value: 3, confidence: 0.5, rationale: null },\n    linking: { value: 3, confidence: 0.5, rationale: null },\n    processing: { value: 3, confidence: 0.5, rationale: null },\n    navigation: { value: 3, confidence: 0.5, rationale: null },\n    maintenance: { value: 3, confidence: 0.5, rationale: null },\n    schema: { value: 3, confidence: 0.5, rationale: null },\n    automation: { value: 3, confidence: 0.5, rationale: null },\n};\nconst dim = action.input.dimension;\nif (dim in state.dimensions) {\n    (state.dimensions as any)[dim] = {\n        value: action.input.value,\n        confidence: action.input.confidence,\n        rationale: action.input.rationale || null,\n    };\n}\nstate.updatedAt = action.input.updatedAt;",
              examples: [],
              template: "Update a dimension position",
              description: "Update a dimension position",
            },
            {
              id: "update-vocabulary",
              name: "UPDATE_VOCABULARY",
              scope: "global",
              errors: [],
              schema:
                "input UpdateVocabularyInput {\n    key: String!\n    value: String!\n    updatedAt: DateTime!\n}",
              reducer:
                'if (!state.vocabulary) state.vocabulary = {\n    notes: "notes", inbox: "inbox", reduce: "reduce", reflect: "reflect",\n    reweave: "reweave", verify: "verify", rethink: "rethink",\n    topicMap: "topic map", description: "description",\n};\nif (action.input.key in state.vocabulary) {\n    (state.vocabulary as any)[action.input.key] = action.input.value;\n}\nstate.updatedAt = action.input.updatedAt;',
              examples: [],
              template: "Update a vocabulary term",
              description: "Update a vocabulary term",
            },
            {
              id: "update-pipeline-config",
              name: "UPDATE_PIPELINE_CONFIG",
              scope: "global",
              errors: [],
              schema:
                "input UpdatePipelineConfigInput {\n    depth: String\n    autoChain: Boolean\n    extractionSelectivity: Float\n    updatedAt: DateTime!\n}",
              reducer:
                'if (!state.pipeline) state.pipeline = { depth: "standard", autoChain: false, extractionSelectivity: 0.1 };\nif (action.input.depth) state.pipeline.depth = action.input.depth;\nif (action.input.autoChain !== undefined && action.input.autoChain !== null) state.pipeline.autoChain = action.input.autoChain;\nif (action.input.extractionSelectivity !== undefined && action.input.extractionSelectivity !== null) state.pipeline.extractionSelectivity = action.input.extractionSelectivity;\nstate.updatedAt = action.input.updatedAt;',
              examples: [],
              template: "Update pipeline settings",
              description: "Update pipeline settings",
            },
            {
              id: "update-maintenance-threshold",
              name: "UPDATE_MAINTENANCE_THRESHOLD",
              scope: "global",
              errors: [],
              schema:
                "input UpdateMaintenanceThresholdInput {\n    condition: String!\n    threshold: Int!\n    updatedAt: DateTime!\n}",
              reducer:
                "if (!state.maintenance) state.maintenance = {\n    orphanThreshold: 1, danglingThreshold: 1, inboxPressure: 5,\n    observationAccumulation: 10, tensionAccumulation: 5, mocOversize: 40, staleNoteDays: 30,\n};\nif (action.input.condition in state.maintenance) {\n    (state.maintenance as any)[action.input.condition] = action.input.threshold;\n}\nstate.updatedAt = action.input.updatedAt;",
              examples: [],
              template: "Update a maintenance threshold",
              description: "Update a maintenance threshold",
            },
            {
              id: "add-extraction-category",
              name: "ADD_EXTRACTION_CATEGORY",
              scope: "global",
              errors: [],
              schema:
                "input AddExtractionCategoryInput {\n    id: OID!\n    name: String!\n    description: String!\n    active: Boolean!\n}",
              reducer:
                "state.extractionCategories.push({\n    id: action.input.id,\n    name: action.input.name,\n    description: action.input.description,\n    active: action.input.active,\n});",
              examples: [],
              template: "Add an extraction category",
              description: "Add an extraction category",
            },
            {
              id: "toggle-extraction-category",
              name: "TOGGLE_EXTRACTION_CATEGORY",
              scope: "global",
              errors: [],
              schema:
                "input ToggleExtractionCategoryInput {\n    id: OID!\n    active: Boolean!\n}",
              reducer:
                "const cat = state.extractionCategories.find(c => c.id === action.input.id);\nif (cat) cat.active = action.input.active;",
              examples: [],
              template: "Enable/disable an extraction category",
              description: "Enable/disable an extraction category",
            },
            {
              id: "toggle-feature",
              name: "TOGGLE_FEATURE",
              scope: "global",
              errors: [],
              schema:
                "input ToggleFeatureInput {\n    feature: String!\n    enabled: Boolean!\n}",
              reducer:
                "if (action.input.enabled && !state.features.includes(action.input.feature)) {\n    state.features.push(action.input.feature);\n} else if (!action.input.enabled) {\n    state.features = state.features.filter(f => f !== action.input.feature);\n}",
              examples: [],
              template: "Enable/disable a feature block",
              description: "Enable/disable a feature block",
            },
          ],
          description: "Vault configuration lifecycle",
        },
      ],
      version: 1,
      changeLog: [],
    },
  ],
};
