import {
  addExtractedClaim,
  ingestSource,
  recordExtractionStats,
  reducer,
  setSourceStatus,
  utils,
} from "document-models/source/v1";
import { describe, expect, it } from "vitest";

const T = "2026-01-01T00:00:00.000Z";
const stats = (claimCount: number, skippedCount = 0, skipRate = 0) =>
  recordExtractionStats({ claimCount, skippedCount, skipRate, extractedAt: T });

// RECORD_EXTRACTION_STATS used to validate nothing: a live drive ended up with
// 50 sources whose claimCount disagreed with their claim list.
describe("extraction stats invariants", () => {
  it("requires claimCount to equal the number of extracted claims", () => {
    let document = reducer(utils.createDocument(), addExtractedClaim({ claimRef: "n1" }));
    document = reducer(document, addExtractedClaim({ claimRef: "n2" }));

    document = reducer(document, stats(9));
    expect(document.operations.global[2].error).toBe(
      "claimCount 9 does not match the 2 extracted claims on this source; add the claims first",
    );
    expect(document.state.global.extractionStats).toBeNull();

    document = reducer(document, stats(2, 3, 0.6));
    expect(document.operations.global[3].error).toBeUndefined();
    expect(document.state.global.extractionStats?.claimCount).toBe(2);
  });

  it("rejects negative counts and a skipRate outside 0..1", () => {
    let document = reducer(utils.createDocument(), stats(0, 0, 1.5));
    expect(document.operations.global[0].error).toBe(
      "claimCount and skippedCount must be >= 0 and skipRate within 0..1",
    );
    document = reducer(document, stats(0, -1, 0));
    expect(document.operations.global[1].error).toBe(
      "claimCount and skippedCount must be >= 0 and skipRate within 0..1",
    );
    // zero claims with a full skip rate is a legal (and honest) close-out
    document = reducer(document, stats(0, 12, 1));
    expect(document.operations.global[2].error).toBeUndefined();
  });
});

// INBOX → EXTRACTING → EXTRACTED → ARCHIVED, with EXTRACTING→INBOX,
// EXTRACTED→EXTRACTING and ARCHIVED→INBOX as the only ways back.
describe("source status transitions", () => {
  const at = (...statuses: ("INBOX" | "EXTRACTING" | "EXTRACTED" | "ARCHIVED")[]) =>
    statuses.reduce(
      (doc, status) => reducer(doc, setSourceStatus({ status })),
      utils.createDocument(),
    );

  it("walks the lifecycle forward and back through the allowed edges", () => {
    const document = at("EXTRACTING", "EXTRACTED", "EXTRACTING", "INBOX", "ARCHIVED", "INBOX");
    for (const op of document.operations.global) expect(op.error).toBeUndefined();
    expect(document.state.global.status).toBe("INBOX");
  });

  it("refuses to skip a step or archive-and-extract", () => {
    let document = at("EXTRACTED");
    expect(document.operations.global[0].error).toBe(
      "A source cannot move from INBOX to EXTRACTED",
    );
    expect(document.state.global.status).toBe("INBOX");

    document = at("ARCHIVED", "EXTRACTED");
    expect(document.operations.global[1].error).toBe(
      "A source cannot move from ARCHIVED to EXTRACTED",
    );
    document = at("EXTRACTING", "EXTRACTED", "INBOX");
    expect(document.operations.global[2].error).toBe(
      "A source cannot move from EXTRACTED to INBOX",
    );
  });

  it("treats a source with no status as INBOX", () => {
    const document = utils.createDocument();
    document.state.global.status = null;
    const updated = reducer(document, setSourceStatus({ status: "EXTRACTING" }));
    expect(updated.operations.global[0].error).toBeUndefined();
    expect(updated.state.global.status).toBe("EXTRACTING");
  });

  it("treats setting the current status again as a no-op", () => {
    const document = at("INBOX", "EXTRACTING", "EXTRACTING");
    for (const op of document.operations.global) expect(op.error).toBeUndefined();
    expect(document.state.global.status).toBe("EXTRACTING");
  });
});

describe("ingest provenance", () => {
  it("keeps method and tool even when url, author and publishedAt are absent", () => {
    const document = reducer(
      utils.createDocument(),
      ingestSource({
        title: "t",
        content: "c",
        sourceType: "ARTICLE",
        method: "pdf-extract",
        tool: "seed-source.mjs",
        createdAt: T,
      }),
    );
    expect(document.state.global.provenance).toStrictEqual({
      url: null,
      author: null,
      publishedAt: null,
      method: "pdf-extract",
      tool: "seed-source.mjs",
    });
  });
});
