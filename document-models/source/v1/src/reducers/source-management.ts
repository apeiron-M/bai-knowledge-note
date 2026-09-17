import type {
  SourceSourceManagementOperations,
  SourceStatus,
} from "document-models/source/v1";
import {
  ClaimNotFoundError,
  ExtractionStatsMismatchError,
  InvalidExtractionStatsError,
  InvalidSourceStatusTransitionError,
  OriginalAlreadyAttachedError,
} from "../../gen/source-management/error.js";

// Lifecycle: INBOX → EXTRACTING → EXTRACTED → ARCHIVED. The only ways back are
// EXTRACTING → INBOX (un-queue), EXTRACTED → EXTRACTING (re-extract) and
// ARCHIVED → INBOX (restore). Setting the current status again is a no-op.
const ALLOWED_TRANSITIONS: Record<SourceStatus, readonly SourceStatus[]> = {
  INBOX: ["EXTRACTING", "ARCHIVED"],
  EXTRACTING: ["EXTRACTED", "INBOX", "ARCHIVED"],
  EXTRACTED: ["ARCHIVED", "EXTRACTING"],
  ARCHIVED: ["INBOX"],
};

export const sourceSourceManagementOperations: SourceSourceManagementOperations =
  {
    ingestSourceOperation(state, action) {
      state.title = action.input.title;
      state.content = action.input.content;
      state.sourceType = action.input.sourceType;
      state.description = action.input.description || null;
      state.status = "INBOX";
      state.createdAt = action.input.createdAt;
      state.createdBy = action.input.createdBy || null;
      // Provenance is built when ANY of its fields is given — method/tool
      // alone used to be discarded silently.
      const { url, author, publishedAt, method, tool } = action.input;
      if (url || author || publishedAt || method || tool) {
        state.provenance = {
          url: url || null,
          author: author || null,
          publishedAt: publishedAt || null,
          method: method || null,
          tool: tool || null,
        };
      }
    },
    setSourceStatusOperation(state, action) {
      const from: SourceStatus = state.status || "INBOX";
      const to = action.input.status;
      if (from === to) return;
      if (!ALLOWED_TRANSITIONS[from].includes(to)) {
        throw new InvalidSourceStatusTransitionError(
          `A source cannot move from ${from} to ${to}`,
        );
      }
      state.status = to;
    },
    addExtractedClaimOperation(state, action) {
      // Idempotent on claimRef: a claim is listed once, however many times an
      // extraction, a sync or a retry asserts it. Re-adding is a no-op, not an
      // error, so pipelines can assert membership without reading state first.
      if (state.extractedClaims.includes(action.input.claimRef)) {
        return;
      }
      state.extractedClaims.push(action.input.claimRef);
    },
    recordExtractionStatsOperation(state, action) {
      const { claimCount, skippedCount, skipRate } = action.input;
      if (claimCount < 0 || skippedCount < 0 || skipRate < 0 || skipRate > 1) {
        throw new InvalidExtractionStatsError(
          "claimCount and skippedCount must be >= 0 and skipRate within 0..1",
        );
      }
      // The close-out invariant: the count the source reports must be the
      // number of claims it actually lists. Add the claims first.
      if (claimCount !== state.extractedClaims.length) {
        throw new ExtractionStatsMismatchError(
          `claimCount ${claimCount} does not match the ${state.extractedClaims.length} extracted claims on this source; add the claims first`,
        );
      }
      state.extractionStats = {
        claimCount,
        skippedCount,
        skipRate,
        extractedAt: action.input.extractedAt,
        extractedBy: action.input.extractedBy || null,
      };
    },
    removeExtractedClaimOperation(state, action) {
      if (!state.extractedClaims.includes(action.input.claimRef)) {
        throw new ClaimNotFoundError(
          `Claim ${action.input.claimRef} is not listed on this source`,
        );
      }
      // Every occurrence: this also repairs lists that grew duplicates before
      // ADD_EXTRACTED_CLAIM became idempotent.
      state.extractedClaims = state.extractedClaims.filter(
        (ref) => ref !== action.input.claimRef,
      );
    },
    attachOriginalFileOperation(state, action) {
      if (
        state.originalFile &&
        state.originalFile !== action.input.originalFile
      ) {
        throw new OriginalAlreadyAttachedError(
          "This source already has an original file; attach it again only with the same ref",
        );
      }
      state.originalFile = action.input.originalFile;
      state.originalFileName = action.input.originalFileName || null;
      state.originalMimeType = action.input.originalMimeType || null;
      state.originalSizeBytes = action.input.originalSizeBytes ?? null;
      state.originalAttachedAt = action.input.attachedAt;
      state.convertedBy = action.input.convertedBy || null;
    },
  };
