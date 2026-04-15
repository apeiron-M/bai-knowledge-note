import type { SourceSourceManagementOperations } from "document-models/source/v1";

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
  };
