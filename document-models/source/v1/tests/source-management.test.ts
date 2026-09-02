import { generateMock } from "document-model/mock";
import {
  addExtractedClaim,
  AddExtractedClaimInputSchema,
  ingestSource,
  IngestSourceInputSchema,
  isSourceDocument,
  recordExtractionStats,
  RecordExtractionStatsInputSchema,
  reducer,
  removeExtractedClaim,
  RemoveExtractedClaimInputSchema,
  setSourceStatus,
  SetSourceStatusInputSchema,
  utils,
} from "document-models/source/v1";
import { describe, expect, it } from "vitest";

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

  it("should ingest a minimal source without optional fields", () => {
    const document = utils.createDocument();

    const updatedDocument = reducer(
      document,
      ingestSource({
        title: "Minimal source",
        content: "Some raw content",
        sourceType: "MANUAL_ENTRY",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    expect(updatedDocument.state.global.title).toBe("Minimal source");
    expect(updatedDocument.state.global.content).toBe("Some raw content");
    expect(updatedDocument.state.global.sourceType).toBe("MANUAL_ENTRY");
    expect(updatedDocument.state.global.status).toBe("INBOX");
    expect(updatedDocument.state.global.description).toBeNull();
    expect(updatedDocument.state.global.createdBy).toBeNull();
    // No url/author/publishedAt -> provenance stays unset
    expect(updatedDocument.state.global.provenance).toBeNull();
  });

  it("should ingest a fully specified source with complete provenance", () => {
    const document = utils.createDocument();

    const updatedDocument = reducer(
      document,
      ingestSource({
        title: "Full source",
        content: "Article body",
        sourceType: "ARTICLE",
        description: "An article about knowledge graphs",
        createdAt: "2026-01-02T00:00:00.000Z",
        createdBy: "liberuum",
        url: "https://example.com/article",
        author: "Jane Doe",
        publishedAt: "2025-12-31T00:00:00.000Z",
        method: "web-clip",
        tool: "exa",
      }),
    );

    expect(updatedDocument.state.global.description).toBe(
      "An article about knowledge graphs",
    );
    expect(updatedDocument.state.global.createdBy).toBe("liberuum");
    expect(updatedDocument.state.global.provenance).toStrictEqual({
      url: "https://example.com/article",
      author: "Jane Doe",
      publishedAt: "2025-12-31T00:00:00.000Z",
      method: "web-clip",
      tool: "exa",
    });
  });

  it("should set provenance when only url is provided", () => {
    const document = utils.createDocument();

    const updatedDocument = reducer(
      document,
      ingestSource({
        title: "Url-only source",
        content: "Body",
        sourceType: "WEB_PAGE",
        createdAt: "2026-01-03T00:00:00.000Z",
        url: "https://example.com/page",
      }),
    );

    expect(updatedDocument.state.global.provenance).toStrictEqual({
      url: "https://example.com/page",
      author: null,
      publishedAt: null,
      method: null,
      tool: null,
    });
  });

  it("should set provenance when only author is provided", () => {
    const document = utils.createDocument();

    const updatedDocument = reducer(
      document,
      ingestSource({
        title: "Author-only source",
        content: "Body",
        sourceType: "BOOK_CHAPTER",
        createdAt: "2026-01-04T00:00:00.000Z",
        author: "John Smith",
      }),
    );

    expect(updatedDocument.state.global.provenance).toStrictEqual({
      url: null,
      author: "John Smith",
      publishedAt: null,
      method: null,
      tool: null,
    });
  });

  it("should set provenance when only publishedAt is provided", () => {
    const document = utils.createDocument();

    const updatedDocument = reducer(
      document,
      ingestSource({
        title: "PublishedAt-only source",
        content: "Body",
        sourceType: "PAPER",
        createdAt: "2026-01-05T00:00:00.000Z",
        publishedAt: "2025-06-15T00:00:00.000Z",
      }),
    );

    expect(updatedDocument.state.global.provenance).toStrictEqual({
      url: null,
      author: null,
      publishedAt: "2025-06-15T00:00:00.000Z",
      method: null,
      tool: null,
    });
  });

  it("should handle a full extraction flow with and without extractedBy", () => {
    const document = utils.createDocument();

    let updatedDocument = reducer(
      document,
      ingestSource({
        title: "Flow source",
        content: "Body",
        sourceType: "TRANSCRIPT",
        createdAt: "2026-01-06T00:00:00.000Z",
      }),
    );

    updatedDocument = reducer(
      updatedDocument,
      setSourceStatus({ status: "EXTRACTING" }),
    );
    expect(updatedDocument.state.global.status).toBe("EXTRACTING");

    updatedDocument = reducer(
      updatedDocument,
      addExtractedClaim({ claimRef: "claim-1" }),
    );
    updatedDocument = reducer(
      updatedDocument,
      addExtractedClaim({ claimRef: "claim-2" }),
    );
    expect(updatedDocument.state.global.extractedClaims).toStrictEqual([
      "claim-1",
      "claim-2",
    ]);

    // Without extractedBy -> stored as null
    updatedDocument = reducer(
      updatedDocument,
      recordExtractionStats({
        claimCount: 2,
        skippedCount: 0,
        skipRate: 0,
        extractedAt: "2026-01-06T01:00:00.000Z",
      }),
    );
    expect(updatedDocument.state.global.extractionStats).toStrictEqual({
      claimCount: 2,
      skippedCount: 0,
      skipRate: 0,
      extractedAt: "2026-01-06T01:00:00.000Z",
      extractedBy: null,
    });

    // With extractedBy -> stored as provided
    updatedDocument = reducer(
      updatedDocument,
      recordExtractionStats({
        claimCount: 3,
        skippedCount: 1,
        skipRate: 0.25,
        extractedAt: "2026-01-06T02:00:00.000Z",
        extractedBy: "claude",
      }),
    );
    expect(updatedDocument.state.global.extractionStats).toStrictEqual({
      claimCount: 3,
      skippedCount: 1,
      skipRate: 0.25,
      extractedAt: "2026-01-06T02:00:00.000Z",
      extractedBy: "claude",
    });

    updatedDocument = reducer(
      updatedDocument,
      setSourceStatus({ status: "EXTRACTED" }),
    );
    expect(updatedDocument.state.global.status).toBe("EXTRACTED");
    expect(updatedDocument.operations.global).toHaveLength(7);
  });

  it("should handle removeExtractedClaim operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveExtractedClaimInputSchema());

    const updatedDocument = reducer(document, removeExtractedClaim(input));

    expect(isSourceDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_EXTRACTED_CLAIM",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  // The claim list as a set: this is the contract the skill sync and the
  // extraction pipeline rely on. Before it, every re-sync appended the same
  // note id again and the Sources list showed "4 claims" for one note.
  it("lists a claim once however many times it is added, and removes every occurrence", () => {
    let document = utils.createDocument();
    document = reducer(document, addExtractedClaim({ claimRef: "note-a" }));
    document = reducer(document, addExtractedClaim({ claimRef: "note-b" }));
    document = reducer(document, addExtractedClaim({ claimRef: "note-a" }));
    document = reducer(document, addExtractedClaim({ claimRef: "note-a" }));

    expect(document.state.global.extractedClaims).toStrictEqual([
      "note-a",
      "note-b",
    ]);
    // The repeated adds are recorded as operations without error — a
    // pipeline may assert membership blindly — but change nothing.
    expect(document.operations.global).toHaveLength(4);
    expect(document.operations.global.every((op) => !op.error)).toBe(true);

    document = reducer(document, removeExtractedClaim({ claimRef: "note-a" }));
    expect(document.state.global.extractedClaims).toStrictEqual(["note-b"]);
    expect(document.operations.global[4].error).toBeUndefined();
  });

  it("repairs a list that already holds duplicates: one remove clears them all", () => {
    // A document whose history predates the idempotent add: build the
    // duplicate state through the initial value, as the migration would find it.
    const document = utils.createDocument();
    document.state.global.extractedClaims = ["note-a", "note-a", "note-b", "note-a"];

    const updated = reducer(document, removeExtractedClaim({ claimRef: "note-a" }));

    expect(updated.state.global.extractedClaims).toStrictEqual(["note-b"]);
    expect(updated.operations.global[0].error).toBeUndefined();
  });

  it("records CLAIM_NOT_FOUND and leaves state untouched when removing an unlisted claim", () => {
    let document = utils.createDocument();
    document = reducer(document, addExtractedClaim({ claimRef: "note-a" }));

    const updated = reducer(document, removeExtractedClaim({ claimRef: "note-zzz" }));

    expect(updated.operations.global[1].error).toBe(
      "Claim note-zzz is not listed on this source",
    );
    expect(updated.state.global.extractedClaims).toStrictEqual(["note-a"]);
  });
});
