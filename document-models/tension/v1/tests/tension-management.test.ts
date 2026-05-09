import { generateMock } from "document-model";
import {
  addInvolvedRef,
  AddInvolvedRefInputSchema,
  createTension,
  CreateTensionInputSchema,
  dissolveTension,
  DissolveTensionInputSchema,
  isTensionDocument,
  reducer,
  resolveTension,
  ResolveTensionInputSchema,
  utils,
} from "document-models/tension/v1";
import { describe, expect, it } from "vitest";

describe("TensionManagementOperations", () => {
  it("should handle createTension operation", () => {
    const document = utils.createDocument();
    const input = generateMock(CreateTensionInputSchema());

    const updatedDocument = reducer(document, createTension(input));

    expect(isTensionDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CREATE_TENSION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle resolveTension operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ResolveTensionInputSchema());

    const updatedDocument = reducer(document, resolveTension(input));

    expect(isTensionDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "RESOLVE_TENSION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle dissolveTension operation", () => {
    const document = utils.createDocument();
    const input = generateMock(DissolveTensionInputSchema());

    const updatedDocument = reducer(document, dissolveTension(input));

    expect(isTensionDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "DISSOLVE_TENSION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addInvolvedRef operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddInvolvedRefInputSchema());

    const updatedDocument = reducer(document, addInvolvedRef(input));

    expect(isTensionDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_INVOLVED_REF",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
