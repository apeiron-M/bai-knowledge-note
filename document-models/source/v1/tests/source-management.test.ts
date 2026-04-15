import { generateMock } from "document-model";
import { describe, expect, it } from "vitest";
import {
  reducer,
  utils,
  isSourceDocument,
  ingestSource,
  setSourceStatus,
  addExtractedClaim,
  recordExtractionStats,
  IngestSourceInputSchema,
  SetSourceStatusInputSchema,
  AddExtractedClaimInputSchema,
  RecordExtractionStatsInputSchema,
} from "document-models/source/v1";

describe("SourceManagementOperations", () => {
  it("should handle ingestSource operation", () => {
    const document = utils.createDocument();
    const input = generateMock(IngestSourceInputSchema());

    const updatedDocument = reducer(document, ingestSource(input));

    expect(isSourceDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "INGEST_SOURCE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setSourceStatus operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetSourceStatusInputSchema());

    const updatedDocument = reducer(document, setSourceStatus(input));

    expect(isSourceDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_SOURCE_STATUS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addExtractedClaim operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddExtractedClaimInputSchema());

    const updatedDocument = reducer(document, addExtractedClaim(input));

    expect(isSourceDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_EXTRACTED_CLAIM",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle recordExtractionStats operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RecordExtractionStatsInputSchema());

    const updatedDocument = reducer(document, recordExtractionStats(input));

    expect(isSourceDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "RECORD_EXTRACTION_STATS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
