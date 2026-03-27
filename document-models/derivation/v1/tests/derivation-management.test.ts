import { generateMock } from "@powerhousedao/common/utils";
import { describe, expect, it } from "vitest";
import {
  reducer,
  utils,
  isDerivationDocument,
  initializeDerivation,
  addSignal,
  addReseedEntry,
  updateDimensionRationale,
  InitializeDerivationInputSchema,
  AddSignalInputSchema,
  AddReseedEntryInputSchema,
  UpdateDimensionRationaleInputSchema,
} from "@powerhousedao/knowledge-note/document-models/derivation/v1";

describe("DerivationManagementOperations", () => {
  it("should handle initializeDerivation operation", () => {
    const document = utils.createDocument();
    const input = generateMock(InitializeDerivationInputSchema());

    const updatedDocument = reducer(document, initializeDerivation(input));

    expect(isDerivationDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "INITIALIZE_DERIVATION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addSignal operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddSignalInputSchema());

    const updatedDocument = reducer(document, addSignal(input));

    expect(isDerivationDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("ADD_SIGNAL");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addReseedEntry operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddReseedEntryInputSchema());

    const updatedDocument = reducer(document, addReseedEntry(input));

    expect(isDerivationDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_RESEED_ENTRY",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateDimensionRationale operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateDimensionRationaleInputSchema());

    const updatedDocument = reducer(document, updateDimensionRationale(input));

    expect(isDerivationDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_DIMENSION_RATIONALE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
