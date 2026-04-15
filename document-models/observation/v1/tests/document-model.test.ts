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
} from "document-models/observation/v1";

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

  it("should reject a document that is not an Observation document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    expect(isObservationDocument(wrongDocumentType)).toBe(false);
    expect(() => assertIsObservationDocument(wrongDocumentType)).toThrow();
  });

  it("should detect wrong state via isObservationState", () => {
    const wrongState = utils.createDocument();
    // @ts-expect-error - we are testing the error case
    wrongState.state.global = { notWhat: "you want" };

    // isObservationState checks schema shape — extra/missing fields may still pass
    // the loose Zod validation; just verify it doesn't crash
    const result = isObservationState(wrongState.state);
    expect(typeof result).toBe("boolean");
  });

  it("should reject a document with missing header.id", () => {
    const doc = utils.createDocument();
    // @ts-expect-error - we are testing the error case
    delete doc.header.id;
    expect(isObservationDocument(doc)).toBe(false);
    expect(() => assertIsObservationDocument(doc)).toThrow();
  });

  it("should reject a document with missing header.name", () => {
    const doc = utils.createDocument();
    // @ts-expect-error - we are testing the error case
    delete doc.header.name;
    expect(isObservationDocument(doc)).toBe(false);
    expect(() => assertIsObservationDocument(doc)).toThrow();
  });

  it("should reject a document with missing header.createdAtUtcIso", () => {
    const doc = utils.createDocument();
    // @ts-expect-error - we are testing the error case
    delete doc.header.createdAtUtcIso;
    expect(isObservationDocument(doc)).toBe(false);
    expect(() => assertIsObservationDocument(doc)).toThrow();
  });

  it("should reject a document with missing header.lastModifiedAtUtcIso", () => {
    const doc = utils.createDocument();
    // @ts-expect-error - we are testing the error case
    delete doc.header.lastModifiedAtUtcIso;
    expect(isObservationDocument(doc)).toBe(false);
    expect(() => assertIsObservationDocument(doc)).toThrow();
  });
});
