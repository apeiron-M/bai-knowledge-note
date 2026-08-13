import { generateMock } from "document-model";
import {
  addExtractionCategory,
  AddExtractionCategoryInputSchema,
  initializeConfig,
  InitializeConfigInputSchema,
  isVaultConfigDocument,
  reducer,
  toggleExtractionCategory,
  ToggleExtractionCategoryInputSchema,
  toggleFeature,
  ToggleFeatureInputSchema,
  updateDimension,
  UpdateDimensionInputSchema,
  updateMaintenanceThreshold,
  UpdateMaintenanceThresholdInputSchema,
  updatePipelineConfig,
  UpdatePipelineConfigInputSchema,
  updateVocabulary,
  UpdateVocabularyInputSchema,
  utils,
} from "document-models/vault-config/v1";
import { describe, expect, it } from "vitest";

describe("ConfigManagementOperations", () => {
  it("should handle initializeConfig operation", () => {
    const document = utils.createDocument();
    const input = generateMock(InitializeConfigInputSchema());

    const updatedDocument = reducer(document, initializeConfig(input));

    expect(isVaultConfigDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "INITIALIZE_CONFIG",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateDimension operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateDimensionInputSchema());

    const updatedDocument = reducer(document, updateDimension(input));

    expect(isVaultConfigDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_DIMENSION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateVocabulary operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateVocabularyInputSchema());

    const updatedDocument = reducer(document, updateVocabulary(input));

    expect(isVaultConfigDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_VOCABULARY",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updatePipelineConfig operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdatePipelineConfigInputSchema());

    const updatedDocument = reducer(document, updatePipelineConfig(input));

    expect(isVaultConfigDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_PIPELINE_CONFIG",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateMaintenanceThreshold operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateMaintenanceThresholdInputSchema());

    const updatedDocument = reducer(
      document,
      updateMaintenanceThreshold(input),
    );

    expect(isVaultConfigDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_MAINTENANCE_THRESHOLD",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addExtractionCategory operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddExtractionCategoryInputSchema());

    const updatedDocument = reducer(document, addExtractionCategory(input));

    expect(isVaultConfigDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_EXTRACTION_CATEGORY",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle toggleExtractionCategory operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ToggleExtractionCategoryInputSchema());

    const updatedDocument = reducer(document, toggleExtractionCategory(input));

    expect(isVaultConfigDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "TOGGLE_EXTRACTION_CATEGORY",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle toggleFeature operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ToggleFeatureInputSchema());

    const updatedDocument = reducer(document, toggleFeature(input));

    expect(isVaultConfigDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "TOGGLE_FEATURE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});

describe("ConfigManagementOperations scenarios", () => {
  const ts = "2026-08-07T00:00:00.000Z";
  const laterTs = "2026-08-07T01:00:00.000Z";

  it("should initialize config and set name, domain and updatedAt", () => {
    const document = utils.createDocument();

    const updatedDocument = reducer(
      document,
      initializeConfig({ name: "Vault", domain: "knowledge", updatedAt: ts }),
    );

    expect(updatedDocument.state.global.name).toBe("Vault");
    expect(updatedDocument.state.global.domain).toBe("knowledge");
    expect(updatedDocument.state.global.updatedAt).toBe(ts);
  });

  it("should lazily initialize dimensions and update a matched dimension with rationale", () => {
    const document = utils.createDocument();
    expect(document.state.global.dimensions).toBe(null);

    const updatedDocument = reducer(
      document,
      updateDimension({
        dimension: "granularity",
        value: 5,
        confidence: 0.9,
        rationale: "fine-grained notes",
        updatedAt: ts,
      }),
    );

    expect(updatedDocument.state.global.dimensions?.granularity).toStrictEqual({
      value: 5,
      confidence: 0.9,
      rationale: "fine-grained notes",
    });
    // untouched dimensions keep their lazy-init defaults
    expect(updatedDocument.state.global.dimensions?.linking).toStrictEqual({
      value: 3,
      confidence: 0.5,
      rationale: null,
    });
    expect(updatedDocument.state.global.updatedAt).toBe(ts);
  });

  it("should update an existing dimensions object and default missing rationale to null", () => {
    let document = utils.createDocument();
    document = reducer(
      document,
      updateDimension({
        dimension: "granularity",
        value: 5,
        confidence: 0.9,
        rationale: "first",
        updatedAt: ts,
      }),
    );

    // dimensions already initialized: skips the lazy-init branch
    document = reducer(
      document,
      updateDimension({
        dimension: "linking",
        value: 4,
        confidence: 0.7,
        updatedAt: ts,
      }),
    );
    expect(document.state.global.dimensions?.linking).toStrictEqual({
      value: 4,
      confidence: 0.7,
      rationale: null,
    });

    // empty-string rationale is falsy and coerced to null
    document = reducer(
      document,
      updateDimension({
        dimension: "schema",
        value: 2,
        confidence: 0.4,
        rationale: "",
        updatedAt: ts,
      }),
    );
    expect(document.state.global.dimensions?.schema).toStrictEqual({
      value: 2,
      confidence: 0.4,
      rationale: null,
    });
    // earlier update is preserved
    expect(document.state.global.dimensions?.granularity.rationale).toBe(
      "first",
    );
  });

  it("should silently ignore an unknown dimension key while still bumping updatedAt", () => {
    let document = utils.createDocument();
    document = reducer(
      document,
      updateDimension({
        dimension: "automation",
        value: 1,
        confidence: 0.2,
        updatedAt: ts,
      }),
    );
    const dimensionsBefore = document.state.global.dimensions;

    document = reducer(
      document,
      updateDimension({
        dimension: "not-a-dimension",
        value: 5,
        confidence: 1,
        rationale: "ignored",
        updatedAt: laterTs,
      }),
    );

    expect(document.state.global.dimensions).toStrictEqual(dimensionsBefore);
    expect(document.state.global.updatedAt).toBe(laterTs);
    expect(document.operations.global[1].error).toBeUndefined();
  });

  it("should lazily initialize vocabulary, update matched keys and ignore unknown keys", () => {
    let document = utils.createDocument();
    expect(document.state.global.vocabulary).toBe(null);

    // lazy init + matched key
    document = reducer(
      document,
      updateVocabulary({ key: "notes", value: "cards", updatedAt: ts }),
    );
    expect(document.state.global.vocabulary?.notes).toBe("cards");
    expect(document.state.global.vocabulary?.inbox).toBe("inbox");
    expect(document.state.global.vocabulary?.topicMap).toBe("topic map");

    // existing vocabulary: skips the lazy-init branch
    document = reducer(
      document,
      updateVocabulary({ key: "topicMap", value: "atlas", updatedAt: ts }),
    );
    expect(document.state.global.vocabulary?.topicMap).toBe("atlas");

    // unknown key is silently ignored but updatedAt is still set
    document = reducer(
      document,
      updateVocabulary({ key: "glossary", value: "nope", updatedAt: laterTs }),
    );
    expect(document.state.global.vocabulary?.notes).toBe("cards");
    expect(document.state.global.vocabulary?.topicMap).toBe("atlas");
    expect(document.state.global.updatedAt).toBe(laterTs);
    expect(document.operations.global[2].error).toBeUndefined();
  });

  it("should lazily initialize pipeline config with defaults when all optional fields are omitted", () => {
    const document = utils.createDocument();
    expect(document.state.global.pipeline).toBe(null);

    const updatedDocument = reducer(
      document,
      updatePipelineConfig({ updatedAt: ts }),
    );

    expect(updatedDocument.state.global.pipeline).toStrictEqual({
      depth: "standard",
      autoChain: false,
      extractionSelectivity: 0.1,
    });
    expect(updatedDocument.state.global.updatedAt).toBe(ts);
  });

  it("should update all pipeline fields and keep falsy-but-valid values", () => {
    let document = utils.createDocument();

    // set every field on an existing pipeline
    document = reducer(document, updatePipelineConfig({ updatedAt: ts }));
    document = reducer(
      document,
      updatePipelineConfig({
        depth: "deep",
        autoChain: true,
        extractionSelectivity: 0.5,
        updatedAt: ts,
      }),
    );
    expect(document.state.global.pipeline).toStrictEqual({
      depth: "deep",
      autoChain: true,
      extractionSelectivity: 0.5,
    });

    // falsy-but-valid values: autoChain false and extractionSelectivity 0 are
    // applied, empty-string depth is ignored (truthy check)
    document = reducer(
      document,
      updatePipelineConfig({
        depth: "",
        autoChain: false,
        extractionSelectivity: 0,
        updatedAt: ts,
      }),
    );
    expect(document.state.global.pipeline).toStrictEqual({
      depth: "deep",
      autoChain: false,
      extractionSelectivity: 0,
    });

    // explicit nulls leave every field untouched
    document = reducer(
      document,
      updatePipelineConfig({
        depth: null,
        autoChain: null,
        extractionSelectivity: null,
        updatedAt: laterTs,
      }),
    );
    expect(document.state.global.pipeline).toStrictEqual({
      depth: "deep",
      autoChain: false,
      extractionSelectivity: 0,
    });
    expect(document.state.global.updatedAt).toBe(laterTs);
  });

  it("should lazily initialize maintenance thresholds, update matched conditions and ignore unknown ones", () => {
    let document = utils.createDocument();
    expect(document.state.global.maintenance).toBe(null);

    // lazy init + matched condition
    document = reducer(
      document,
      updateMaintenanceThreshold({
        condition: "inboxPressure",
        threshold: 12,
        updatedAt: ts,
      }),
    );
    expect(document.state.global.maintenance?.inboxPressure).toBe(12);
    expect(document.state.global.maintenance?.orphanThreshold).toBe(1);
    expect(document.state.global.maintenance?.staleNoteDays).toBe(30);

    // existing maintenance config: skips the lazy-init branch
    document = reducer(
      document,
      updateMaintenanceThreshold({
        condition: "staleNoteDays",
        threshold: 60,
        updatedAt: ts,
      }),
    );
    expect(document.state.global.maintenance?.staleNoteDays).toBe(60);

    // unknown condition is silently ignored but updatedAt is still set
    document = reducer(
      document,
      updateMaintenanceThreshold({
        condition: "unknownCondition",
        threshold: 99,
        updatedAt: laterTs,
      }),
    );
    expect(document.state.global.maintenance).toStrictEqual({
      orphanThreshold: 1,
      danglingThreshold: 1,
      inboxPressure: 12,
      observationAccumulation: 10,
      tensionAccumulation: 5,
      mocOversize: 40,
      staleNoteDays: 60,
    });
    expect(document.state.global.updatedAt).toBe(laterTs);
    expect(document.operations.global[2].error).toBeUndefined();
  });

  it("should add extraction categories and toggle them, ignoring unknown ids", () => {
    let document = utils.createDocument();

    document = reducer(
      document,
      addExtractionCategory({
        id: "cat-1",
        name: "Claims",
        description: "Research claims",
        active: true,
      }),
    );
    expect(document.state.global.extractionCategories).toStrictEqual([
      {
        id: "cat-1",
        name: "Claims",
        description: "Research claims",
        active: true,
      },
    ]);

    // toggle an existing category off
    document = reducer(
      document,
      toggleExtractionCategory({ id: "cat-1", active: false }),
    );
    expect(document.state.global.extractionCategories[0].active).toBe(false);

    // unknown id is silently ignored
    document = reducer(
      document,
      toggleExtractionCategory({ id: "missing", active: true }),
    );
    expect(document.state.global.extractionCategories[0].active).toBe(false);
    expect(document.state.global.extractionCategories).toHaveLength(1);
    expect(document.operations.global[2].error).toBeUndefined();
  });

  it("should toggle features on and off without duplicating enabled features", () => {
    let document = utils.createDocument();

    // enable a feature not yet present
    document = reducer(
      document,
      toggleFeature({ feature: "graph", enabled: true }),
    );
    expect(document.state.global.features).toStrictEqual(["graph"]);

    // enabling again is a no-op (already included)
    document = reducer(
      document,
      toggleFeature({ feature: "graph", enabled: true }),
    );
    expect(document.state.global.features).toStrictEqual(["graph"]);

    // enable a second feature, then disable the first
    document = reducer(
      document,
      toggleFeature({ feature: "stats", enabled: true }),
    );
    document = reducer(
      document,
      toggleFeature({ feature: "graph", enabled: false }),
    );
    expect(document.state.global.features).toStrictEqual(["stats"]);

    // disabling a feature that is not present leaves the list unchanged
    document = reducer(
      document,
      toggleFeature({ feature: "absent", enabled: false }),
    );
    expect(document.state.global.features).toStrictEqual(["stats"]);
  });
});
