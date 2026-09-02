import type { SourceSourceManagementOperations } from "document-models/source/v1";
import { ClaimNotFoundError } from "../../gen/source-management/error.js";

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
      if (action.input.url || action.input.author || action.input.publishedAt) {
        state.provenance = {
          url: action.input.url || null,
          author: action.input.author || null,
          publishedAt: action.input.publishedAt || null,
          method: action.input.method || null,
          tool: action.input.tool || null,
        };
      }
    },
    setSourceStatusOperation(state, action) {
      state.status = action.input.status;
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
      state.extractionStats = {
        claimCount: action.input.claimCount,
        skippedCount: action.input.skippedCount,
        skipRate: action.input.skipRate,
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
  };
