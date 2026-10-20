import { describe, expect, it } from "vitest";
import { actions } from "document-models/source";
import { effectiveOperations } from "../../shared/document-revisions.js";
import type { DocumentOperation } from "../../shared/document-revisions.js";
import { describeOperation, operationKind, replayToRevision } from "./revisions.js";

const T = "2026-09-02T10:00:00.000Z";

let counter = 0;
function op(
  index: number,
  action: { type: string; input: unknown; scope?: string },
  extra: Partial<DocumentOperation> = {},
): DocumentOperation {
  counter++;
  return {
    index,
    skip: 0,
    timestampUtcMs: T,
    hash: `h${index}`,
    error: null,
    action: {
      id: `a${counter}`,
      type: action.type,
      scope: action.scope ?? "global",
      timestampUtcMs: T,
      input: action.input as Record<string, unknown>,
      context: null,
    },
    ...extra,
  };
}

const ingest = (title: string, content: string) =>
  actions.ingestSource({
    title,
    content,
    sourceType: "ARTICLE",
    description: "A test source",
    createdAt: T,
  });

const history: DocumentOperation[] = [
  op(0, ingest("Raw notes", "para one\npara two")),
  op(1, actions.setSourceStatus({ status: "EXTRACTING" })),
  op(2, actions.addExtractedClaim({ claimRef: "note-aaaa-bbbb" })),
  op(3, actions.addExtractedClaim({ claimRef: "note-cccc-dddd" })),
  op(
    4,
    actions.recordExtractionStats({
      claimCount: 2,
      skippedCount: 1,
      skipRate: 0.333,
      extractedAt: T,
    }),
  ),
  op(5, actions.setSourceStatus({ status: "EXTRACTED" })),
];

describe("replayToRevision", () => {
  it("reconstructs the source as it stood at each revision", () => {
    const r0 = replayToRevision(history, 0).document.state.global;
    expect(r0.title).toBe("Raw notes");
    expect(r0.status).toBe("INBOX");
    expect(r0.extractedClaims).toEqual([]);

    const r3 = replayToRevision(history, 3).document.state.global;
    expect(r3.status).toBe("EXTRACTING");
    expect(r3.extractedClaims).toEqual(["note-aaaa-bbbb", "note-cccc-dddd"]);
    expect(r3.extractionStats).toBeNull();

    const r5 = replayToRevision(history, 5).document.state.global;
    expect(r5.status).toBe("EXTRACTED");
    expect(r5.extractionStats?.claimCount).toBe(2);
  });

  it("shows the raw material a claim was actually extracted from", () => {
    // The Edit form re-dispatches INGEST_SOURCE, so the head content can
    // differ from what the agent read. Replay recovers the original.
    const edited = [...history, op(6, ingest("Raw notes", "para one rewritten"))];
    expect(replayToRevision(edited, 4).document.state.global.content).toBe(
      "para one\npara two",
    );
    expect(replayToRevision(edited, 6).document.state.global.content).toBe(
      "para one rewritten",
    );
  });

  it("is order-insensitive in its input", () => {
    const shuffled = [history[4], history[0], history[5], history[2], history[1], history[3]];
    expect(replayToRevision(shuffled, 5).document.state.global.status).toBe("EXTRACTED");
  });

  it("skips operations the reactor recorded as errored and reports them", () => {
    const withError = [
      ...history,
      op(6, actions.setSourceStatus({ status: "ARCHIVED" }), { error: "boom" }),
    ];
    const r = replayToRevision(withError, 6);
    expect(r.document.state.global.status).toBe("EXTRACTED");
    expect(r.failures).toEqual([
      { index: 6, type: "SET_SOURCE_STATUS", reason: "boom" },
    ]);
  });

  it("folds skip (undo) into the effective list", () => {
    const undone = [
      ...history,
      // index 6 with skip 1: undo index 5 (the move to EXTRACTED)
      op(6, actions.addExtractedClaim({ claimRef: "note-eeee" }), { skip: 1 }),
    ];
    expect(effectiveOperations(undone).map((o) => o.index)).not.toContain(5);
    const r = replayToRevision(undone, 6).document.state.global;
    expect(r.status).toBe("EXTRACTING");
    expect(r.extractedClaims).toContain("note-eeee");
  });
});

describe("presentation helpers", () => {
  it("describes operations in one line", () => {
    expect(describeOperation(history[0])).toBe(
      "Ingested “Raw notes” — ARTICLE, 17 chars",
    );
    expect(describeOperation(history[1])).toBe("Status → EXTRACTING");
    expect(describeOperation(history[2])).toBe("Claim linked → note-aaaa-bb…");
    expect(
      describeOperation(
        op(9, actions.removeExtractedClaim({ claimRef: "note-aaaa-bbbb" })),
      ),
    ).toBe("Claim unlinked → note-aaaa-bb…");
    expect(describeOperation(history[4])).toBe(
      "Extraction recorded: 2 claims, 1 skipped (33.3% skipped)",
    );
    expect(describeOperation(op(9, { type: "SOME_NEW_OP", input: {} }))).toBe(
      "Some new op",
    );
  });

  it("classifies operation kinds", () => {
    expect(operationKind("INGEST_SOURCE")).toBe("content");
    expect(operationKind("SET_SOURCE_STATUS")).toBe("lifecycle");
    expect(operationKind("ADD_EXTRACTED_CLAIM")).toBe("links");
    expect(operationKind("REMOVE_EXTRACTED_CLAIM")).toBe("links");
    expect(operationKind("RECORD_EXTRACTION_STATS")).toBe("metadata");
    expect(operationKind("WHATEVER")).toBe("other");
  });
});
