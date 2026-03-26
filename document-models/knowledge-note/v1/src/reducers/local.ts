import type { KnowledgeNoteLocalOperations } from "knowledge-note/document-models/knowledge-note/v1";

export const knowledgeNoteLocalOperations: KnowledgeNoteLocalOperations = {
  setLastViewedOperation(state, action) {
    state.lastViewedAt = action.input.lastViewedAt;
  },
};
