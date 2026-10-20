/**
 * Per-source time travel: the source half of `shared/document-revisions`.
 *
 * The generic module fetches the operation log, folds undo into it and
 * replays it; all this file adds is the source model (its `createDocument`
 * and `reducer`) and one-line summaries of the source's own operations.
 *
 * A source has only four operations, but its history answers questions the
 * current state cannot: whether the raw material was edited after claims
 * were extracted from it (a re-dispatched INGEST_SOURCE), how many times it
 * went round the pipeline, and which claim was linked when.
 */
import { reducer, utils } from "document-models/source";
import type { SourceAction, SourceDocument } from "document-models/source";
import {
  humanizeOperationType,
  replayDocumentOperations,
  str,
  type DocumentOperation,
  type OperationKind,
  type ReplayResult,
} from "../../shared/document-revisions.js";

/** A source operation, as the reactor returns it. */
export type SourceOperation = DocumentOperation;

/**
 * Replay operations with index ≤ `upToIndex` (inclusive) from an empty
 * source. Reducer errors are recorded and skipped, matching the reactor.
 */
export function replayToRevision(
  ops: SourceOperation[],
  upToIndex: number,
): ReplayResult<SourceDocument> {
  return replayDocumentOperations<SourceDocument>(ops, upToIndex, {
    createDocument: () => utils.createDocument(),
    reducer: (doc, action) => reducer(doc, action as SourceAction),
  });
}

function chars(v: unknown): string {
  return typeof v === "string" ? `${v.length.toLocaleString()} chars` : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

/** One line saying what an operation did, for the revision list. */
export function describeOperation(op: SourceOperation): string {
  const input = op.action.input;
  switch (op.action.type) {
    case "INGEST_SOURCE": {
      const type = str(input.sourceType);
      const parts = [type, chars(input.content)].filter(Boolean).join(", ");
      return `Ingested “${str(input.title, 40)}”${parts ? ` — ${parts}` : ""}`;
    }
    case "SET_SOURCE_STATUS":
      return `Status → ${str(input.status)}`;
    case "ADD_EXTRACTED_CLAIM":
      return `Claim linked → ${str(input.claimRef, 12)}`;
    case "REMOVE_EXTRACTED_CLAIM":
      return `Claim unlinked → ${str(input.claimRef, 12)}`;
    case "RECORD_EXTRACTION_STATS": {
      const claims = num(input.claimCount);
      const skipped = num(input.skippedCount);
      const rate = num(input.skipRate);
      const rateText = rate === null ? "" : ` (${(rate * 100).toFixed(1)}% skipped)`;
      return `Extraction recorded: ${claims ?? "?"} claims, ${skipped ?? "?"} skipped${rateText}`;
    }
    default:
      return humanizeOperationType(op.action.type);
  }
}

/** Which part of the source an operation touched — drives a colour dot. */
export function operationKind(type: string): OperationKind {
  if (type === "INGEST_SOURCE") return "content";
  if (type === "SET_SOURCE_STATUS") return "lifecycle";
  if (type === "ADD_EXTRACTED_CLAIM" || type === "REMOVE_EXTRACTED_CLAIM")
    return "links";
  if (type === "RECORD_EXTRACTION_STATS") return "metadata";
  return "other";
}
