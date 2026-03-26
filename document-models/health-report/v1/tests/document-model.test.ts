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
  healthReportDocumentType,
  isHealthReportDocument,
  assertIsHealthReportDocument,
  isHealthReportState,
  assertIsHealthReportState,
} from "knowledge-note/document-models/health-report/v1";
import { ZodError } from "zod";

describe("HealthReport Document Model", () => {
  it("should create a new HealthReport document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(healthReportDocumentType);
  });

  it("should create a new HealthReport document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isHealthReportDocument(document)).toBe(true);
    expect(isHealthReportState(document.state)).toBe(true);
  });
  it("should reject a document that is not a HealthReport document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsHealthReportDocument(wrongDocumentType)).toThrow();
      expect(isHealthReportDocument(wrongDocumentType)).toBe(false);
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
    expect(isHealthReportState(wrongState.state)).toBe(false);
    expect(assertIsHealthReportState(wrongState.state)).toThrow();
    expect(isHealthReportDocument(wrongState)).toBe(false);
    expect(assertIsHealthReportDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const wrongInitialState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongInitialState.initialState.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isHealthReportState(wrongInitialState.state)).toBe(false);
    expect(assertIsHealthReportState(wrongInitialState.state)).toThrow();
    expect(isHealthReportDocument(wrongInitialState)).toBe(false);
    expect(assertIsHealthReportDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isHealthReportDocument(missingIdInHeader)).toBe(false);
    expect(assertIsHealthReportDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isHealthReportDocument(missingNameInHeader)).toBe(false);
    expect(assertIsHealthReportDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isHealthReportDocument(missingCreatedAtUtcIsoInHeader)).toBe(false);
    expect(
      assertIsHealthReportDocument(missingCreatedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(isHealthReportDocument(missingLastModifiedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(
      assertIsHealthReportDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
