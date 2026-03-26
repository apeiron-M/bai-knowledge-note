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
  observationDocumentType,
  isObservationDocument,
  assertIsObservationDocument,
  isObservationState,
  assertIsObservationState,
} from "knowledge-note/document-models/observation/v1";
import { ZodError } from "zod";

describe("Observation Document Model", () => {
  it("should create a new Observation document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(observationDocumentType);
  });

  it("should create a new Observation document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isObservationDocument(document)).toBe(true);
    expect(isObservationState(document.state)).toBe(true);
  });
  it("should reject a document that is not a Observation document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsObservationDocument(wrongDocumentType)).toThrow();
      expect(isObservationDocument(wrongDocumentType)).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
    }
  });
  it("should reject document with wrong document type", () => {
    const wrongType = utils.createDocument();
    wrongType.header.documentType = "wrong/type";
    expect(isObservationDocument(wrongType)).toBe(false);
  });

  it("should reject missing header fields", () => {
    const missingId = utils.createDocument();
    // @ts-expect-error - testing error case
    delete missingId.header.id;
    expect(isObservationDocument(missingId)).toBe(false);
  });
});
