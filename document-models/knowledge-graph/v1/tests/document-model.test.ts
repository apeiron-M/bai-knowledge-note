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
  knowledgeGraphDocumentType,
  isKnowledgeGraphDocument,
  assertIsKnowledgeGraphDocument,
  isKnowledgeGraphState,
  assertIsKnowledgeGraphState,
} from "document-models/knowledge-graph/v1";
import { ZodError } from "zod";

describe("KnowledgeGraph Document Model", () => {
  it("should create a new KnowledgeGraph document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(knowledgeGraphDocumentType);
  });

  it("should create a new KnowledgeGraph document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isKnowledgeGraphDocument(document)).toBe(true);
    expect(isKnowledgeGraphState(document.state)).toBe(true);
  });
  it("should reject a document that is not a KnowledgeGraph document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsKnowledgeGraphDocument(wrongDocumentType)).toThrow();
      expect(isKnowledgeGraphDocument(wrongDocumentType)).toBe(false);
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
    expect(isKnowledgeGraphState(wrongState.state)).toBe(false);
    expect(assertIsKnowledgeGraphState(wrongState.state)).toThrow();
    expect(isKnowledgeGraphDocument(wrongState)).toBe(false);
    expect(assertIsKnowledgeGraphDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const wrongInitialState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongInitialState.initialState.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isKnowledgeGraphState(wrongInitialState.state)).toBe(false);
    expect(assertIsKnowledgeGraphState(wrongInitialState.state)).toThrow();
    expect(isKnowledgeGraphDocument(wrongInitialState)).toBe(false);
    expect(assertIsKnowledgeGraphDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isKnowledgeGraphDocument(missingIdInHeader)).toBe(false);
    expect(assertIsKnowledgeGraphDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isKnowledgeGraphDocument(missingNameInHeader)).toBe(false);
    expect(assertIsKnowledgeGraphDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isKnowledgeGraphDocument(missingCreatedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(
      assertIsKnowledgeGraphDocument(missingCreatedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(isKnowledgeGraphDocument(missingLastModifiedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(
      assertIsKnowledgeGraphDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
