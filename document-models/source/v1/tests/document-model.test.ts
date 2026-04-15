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
  sourceDocumentType,
  isSourceDocument,
  assertIsSourceDocument,
  isSourceState,
  assertIsSourceState,
} from "document-models/source/v1";
import { ZodError } from "zod";

describe("Source Document Model", () => {
  it("should create a new Source document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(sourceDocumentType);
  });

  it("should create a new Source document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isSourceDocument(document)).toBe(true);
    expect(isSourceState(document.state)).toBe(true);
  });
  it("should reject a document that is not a Source document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsSourceDocument(wrongDocumentType)).toThrow();
      expect(isSourceDocument(wrongDocumentType)).toBe(false);
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
    expect(isSourceState(wrongState.state)).toBe(false);
    expect(assertIsSourceState(wrongState.state)).toThrow();
    expect(isSourceDocument(wrongState)).toBe(false);
    expect(assertIsSourceDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const wrongInitialState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongInitialState.initialState.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isSourceState(wrongInitialState.state)).toBe(false);
    expect(assertIsSourceState(wrongInitialState.state)).toThrow();
    expect(isSourceDocument(wrongInitialState)).toBe(false);
    expect(assertIsSourceDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isSourceDocument(missingIdInHeader)).toBe(false);
    expect(assertIsSourceDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isSourceDocument(missingNameInHeader)).toBe(false);
    expect(assertIsSourceDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isSourceDocument(missingCreatedAtUtcIsoInHeader)).toBe(false);
    expect(assertIsSourceDocument(missingCreatedAtUtcIsoInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(isSourceDocument(missingLastModifiedAtUtcIsoInHeader)).toBe(false);
    expect(
      assertIsSourceDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
