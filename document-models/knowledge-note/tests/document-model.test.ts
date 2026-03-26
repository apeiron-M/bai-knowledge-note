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
  knowledgeNoteDocumentType,
  isKnowledgeNoteDocument,
  assertIsKnowledgeNoteDocument,
  isKnowledgeNoteState,
  assertIsKnowledgeNoteState,
} from "knowledge-note/document-models/knowledge-note";
import { ZodError } from "zod";

describe("KnowledgeNote Document Model", () => {
  it("should create a new KnowledgeNote document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(knowledgeNoteDocumentType);
  });

  it("should create a new KnowledgeNote document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isKnowledgeNoteDocument(document)).toBe(true);
    expect(isKnowledgeNoteState(document.state)).toBe(true);
  });
  it("should reject a document that is not a KnowledgeNote document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsKnowledgeNoteDocument(wrongDocumentType)).toThrow();
      expect(isKnowledgeNoteDocument(wrongDocumentType)).toBe(false);
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
    expect(isKnowledgeNoteState(wrongState.state)).toBe(false);
    expect(assertIsKnowledgeNoteState(wrongState.state)).toThrow();
    expect(isKnowledgeNoteDocument(wrongState)).toBe(false);
    expect(assertIsKnowledgeNoteDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const wrongInitialState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongInitialState.initialState.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isKnowledgeNoteState(wrongInitialState.state)).toBe(false);
    expect(assertIsKnowledgeNoteState(wrongInitialState.state)).toThrow();
    expect(isKnowledgeNoteDocument(wrongInitialState)).toBe(false);
    expect(assertIsKnowledgeNoteDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isKnowledgeNoteDocument(missingIdInHeader)).toBe(false);
    expect(assertIsKnowledgeNoteDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isKnowledgeNoteDocument(missingNameInHeader)).toBe(false);
    expect(assertIsKnowledgeNoteDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isKnowledgeNoteDocument(missingCreatedAtUtcIsoInHeader)).toBe(false);
    expect(
      assertIsKnowledgeNoteDocument(missingCreatedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(isKnowledgeNoteDocument(missingLastModifiedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(
      assertIsKnowledgeNoteDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
