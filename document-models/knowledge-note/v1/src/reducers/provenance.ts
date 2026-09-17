import type { KnowledgeNoteProvenanceOperations } from "document-models/knowledge-note/v1";
import { ProvenanceCreatedAtImmutableError } from "../../gen/provenance/error.js";

export const knowledgeNoteProvenanceOperations: KnowledgeNoteProvenanceOperations =
  {
    setProvenanceOperation(state, action) {
      // createdAt is written once. Author and origin may be corrected later
      // (the editor offers that), but the creation time is not negotiable —
      // pass the existing value back unchanged.
      if (
        state.provenance &&
        action.input.createdAt !== state.provenance.createdAt
      ) {
        throw new ProvenanceCreatedAtImmutableError(
          `provenance.createdAt is ${state.provenance.createdAt} and cannot be changed`,
        );
      }
      // Before the top-level `updatedAt`, setting provenance last replaced the
      // note's only timestamp with createdAt, discarding the edits before it.
      const lastTouched = state.updatedAt || action.input.createdAt;
      state.provenance = {
        author: action.input.author,
        sourceOrigin: action.input.sourceOrigin,
        sessionId: action.input.sessionId || null,
        createdAt: action.input.createdAt,
        updatedAt: lastTouched,
      };
      if (!state.updatedAt) state.updatedAt = action.input.createdAt;
    },
  };
