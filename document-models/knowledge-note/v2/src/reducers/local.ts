import type { KnowledgeNoteLocalOperations } from "document-models/knowledge-note/v2";

export const knowledgeNoteLocalOperations: KnowledgeNoteLocalOperations = {
  setLastViewedOperation(state, action) {
    state.lastViewedAt = action.input.lastViewedAt;
  },
};
