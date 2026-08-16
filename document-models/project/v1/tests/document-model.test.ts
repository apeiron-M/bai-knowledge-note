/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */
/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */

import {
  assertIsProjectDocument,
  assertIsProjectState,
  initialGlobalState,
  initialLocalState,
  isProjectDocument,
  isProjectState,
  projectDocumentType,
  utils,
} from "document-models/project/v1";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

describe("Project Document Model", () => {
  it("should create a new Project document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(projectDocumentType);
  });

  it("should create a new Project document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isProjectDocument(document)).toBe(true);
    expect(isProjectState(document.state)).toBe(true);
  });
  it("should reject a document that is not a Project document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsProjectDocument(wrongDocumentType)).toThrow();
      expect(isProjectDocument(wrongDocumentType)).toBe(false);
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
    expect(isProjectState(wrongState.state)).toBe(false);
    expect(assertIsProjectState(wrongState.state)).toThrow();
    expect(isProjectDocument(wrongState)).toBe(false);
    expect(assertIsProjectDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const wrongInitialState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongInitialState.initialState.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isProjectState(wrongInitialState.state)).toBe(false);
    expect(assertIsProjectState(wrongInitialState.state)).toThrow();
    expect(isProjectDocument(wrongInitialState)).toBe(false);
    expect(assertIsProjectDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isProjectDocument(missingIdInHeader)).toBe(false);
    expect(assertIsProjectDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isProjectDocument(missingNameInHeader)).toBe(false);
    expect(assertIsProjectDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isProjectDocument(missingCreatedAtUtcIsoInHeader)).toBe(false);
    expect(assertIsProjectDocument(missingCreatedAtUtcIsoInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(isProjectDocument(missingLastModifiedAtUtcIsoInHeader)).toBe(false);
    expect(
      assertIsProjectDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
