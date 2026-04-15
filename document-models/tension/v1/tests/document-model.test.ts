/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */
/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */

import { describe, it, expect } from "vitest";
import {
  utils,
  initialGlobalState,
  initialLocalState,
  tensionDocumentType,
  isTensionDocument,
  assertIsTensionDocument,
  isTensionState,
  assertIsTensionState,
} from "document-models/tension/v1";
import { ZodError } from "zod";

describe("Tension Document Model", () => {
  it("should create a new Tension document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(tensionDocumentType);
  });

  it("should create a new Tension document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isTensionDocument(document)).toBe(true);
    expect(isTensionState(document.state)).toBe(true);
  });
  it("should reject a document that is not a Tension document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsTensionDocument(wrongDocumentType)).toThrow();
      expect(isTensionDocument(wrongDocumentType)).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
    }
  });
  const wrongState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongState.state.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isTensionState(wrongState.state)).toBe(false);
    expect(assertIsTensionState(wrongState.state)).toThrow();
    expect(isTensionDocument(wrongState)).toBe(false);
    expect(assertIsTensionDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const wrongInitialState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongInitialState.initialState.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isTensionState(wrongInitialState.state)).toBe(false);
    expect(assertIsTensionState(wrongInitialState.state)).toThrow();
    expect(isTensionDocument(wrongInitialState)).toBe(false);
    expect(assertIsTensionDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isTensionDocument(missingIdInHeader)).toBe(false);
    expect(assertIsTensionDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isTensionDocument(missingNameInHeader)).toBe(false);
    expect(assertIsTensionDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isTensionDocument(missingCreatedAtUtcIsoInHeader)).toBe(false);
    expect(assertIsTensionDocument(missingCreatedAtUtcIsoInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(isTensionDocument(missingLastModifiedAtUtcIsoInHeader)).toBe(false);
    expect(
      assertIsTensionDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
