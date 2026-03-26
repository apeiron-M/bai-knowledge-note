import { generateMock } from "@powerhousedao/common/utils";
import { describe, expect, it } from "vitest";
import {
  reducer,
  utils,
  isVaultConfigDocument,
  initializeConfig,
  updateDimension,
  updateVocabulary,
  updatePipelineConfig,
  updateMaintenanceThreshold,
  addExtractionCategory,
  toggleExtractionCategory,
  toggleFeature,
  InitializeConfigInputSchema,
  UpdateDimensionInputSchema,
  UpdateVocabularyInputSchema,
  UpdatePipelineConfigInputSchema,
  UpdateMaintenanceThresholdInputSchema,
  AddExtractionCategoryInputSchema,
  ToggleExtractionCategoryInputSchema,
  ToggleFeatureInputSchema,
} from "knowledge-note/document-models/vault-config/v1";

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
