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
  mocDocumentType,
  isMocDocument,
  assertIsMocDocument,
  isMocState,
  assertIsMocState,
} from "knowledge-note/document-models/moc/v1";
import { ZodError } from "zod";

describe("Moc Document Model", () => {
  it("should create a new Moc document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(mocDocumentType);
  });

  it("should create a new Moc document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isMocDocument(document)).toBe(true);
    expect(isMocState(document.state)).toBe(true);
  });
  it("should reject a document that is not a Moc document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsMocDocument(wrongDocumentType)).toThrow();
      expect(isMocDocument(wrongDocumentType)).toBe(false);
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
    expect(isMocState(wrongState.state)).toBe(false);
    expect(assertIsMocState(wrongState.state)).toThrow();
    expect(isMocDocument(wrongState)).toBe(false);
    expect(assertIsMocDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const wrongInitialState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongInitialState.initialState.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isMocState(wrongInitialState.state)).toBe(false);
    expect(assertIsMocState(wrongInitialState.state)).toThrow();
    expect(isMocDocument(wrongInitialState)).toBe(false);
    expect(assertIsMocDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isMocDocument(missingIdInHeader)).toBe(false);
    expect(assertIsMocDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isMocDocument(missingNameInHeader)).toBe(false);
    expect(assertIsMocDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isMocDocument(missingCreatedAtUtcIsoInHeader)).toBe(false);
    expect(assertIsMocDocument(missingCreatedAtUtcIsoInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(isMocDocument(missingLastModifiedAtUtcIsoInHeader)).toBe(false);
    expect(assertIsMocDocument(missingLastModifiedAtUtcIsoInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
