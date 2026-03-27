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
  pipelineQueueDocumentType,
  isPipelineQueueDocument,
  assertIsPipelineQueueDocument,
  isPipelineQueueState,
  assertIsPipelineQueueState,
} from "@powerhousedao/knowledge-note/document-models/pipeline-queue/v1";
import { ZodError } from "zod";

describe("PipelineQueue Document Model", () => {
  it("should create a new PipelineQueue document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(pipelineQueueDocumentType);
  });

  it("should create a new PipelineQueue document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isPipelineQueueDocument(document)).toBe(true);
    expect(isPipelineQueueState(document.state)).toBe(true);
  });
  it("should reject a document that is not a PipelineQueue document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsPipelineQueueDocument(wrongDocumentType)).toThrow();
      expect(isPipelineQueueDocument(wrongDocumentType)).toBe(false);
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
    expect(isPipelineQueueState(wrongState.state)).toBe(false);
    expect(assertIsPipelineQueueState(wrongState.state)).toThrow();
    expect(isPipelineQueueDocument(wrongState)).toBe(false);
    expect(assertIsPipelineQueueDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const wrongInitialState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongInitialState.initialState.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isPipelineQueueState(wrongInitialState.state)).toBe(false);
    expect(assertIsPipelineQueueState(wrongInitialState.state)).toThrow();
    expect(isPipelineQueueDocument(wrongInitialState)).toBe(false);
    expect(assertIsPipelineQueueDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isPipelineQueueDocument(missingIdInHeader)).toBe(false);
    expect(assertIsPipelineQueueDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isPipelineQueueDocument(missingNameInHeader)).toBe(false);
    expect(assertIsPipelineQueueDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isPipelineQueueDocument(missingCreatedAtUtcIsoInHeader)).toBe(false);
    expect(
      assertIsPipelineQueueDocument(missingCreatedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(isPipelineQueueDocument(missingLastModifiedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(
      assertIsPipelineQueueDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
