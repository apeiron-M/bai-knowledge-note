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
  researchClaimDocumentType,
  isResearchClaimDocument,
  assertIsResearchClaimDocument,
  isResearchClaimState,
  assertIsResearchClaimState,
} from "knowledge-note/document-models/research-claim/v1";
import { ZodError } from "zod";

describe("ResearchClaim Document Model", () => {
  it("should create a new ResearchClaim document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(researchClaimDocumentType);
  });

  it("should create a new ResearchClaim document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isResearchClaimDocument(document)).toBe(true);
    expect(isResearchClaimState(document.state)).toBe(true);
  });
  it("should reject a document that is not a ResearchClaim document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsResearchClaimDocument(wrongDocumentType)).toThrow();
      expect(isResearchClaimDocument(wrongDocumentType)).toBe(false);
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
    expect(isResearchClaimState(wrongState.state)).toBe(false);
    expect(assertIsResearchClaimState(wrongState.state)).toThrow();
    expect(isResearchClaimDocument(wrongState)).toBe(false);
    expect(assertIsResearchClaimDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const wrongInitialState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongInitialState.initialState.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isResearchClaimState(wrongInitialState.state)).toBe(false);
    expect(assertIsResearchClaimState(wrongInitialState.state)).toThrow();
    expect(isResearchClaimDocument(wrongInitialState)).toBe(false);
    expect(assertIsResearchClaimDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isResearchClaimDocument(missingIdInHeader)).toBe(false);
    expect(assertIsResearchClaimDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isResearchClaimDocument(missingNameInHeader)).toBe(false);
    expect(assertIsResearchClaimDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isResearchClaimDocument(missingCreatedAtUtcIsoInHeader)).toBe(false);
    expect(
      assertIsResearchClaimDocument(missingCreatedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(isResearchClaimDocument(missingLastModifiedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(
      assertIsResearchClaimDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
