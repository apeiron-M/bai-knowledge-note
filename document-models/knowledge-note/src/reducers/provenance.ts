import type { KnowledgeNoteProvenanceOperations } from "knowledge-note/document-models/knowledge-note";

export const knowledgeNoteProvenanceOperations: KnowledgeNoteProvenanceOperations =
  {
    setProvenanceOperation(state, action) {
      state.provenance = {
        author: action.input.author,
        sourceOrigin: action.input.sourceOrigin,
        sessionId: action.input.sessionId || null,
        createdAt: action.input.createdAt,
        updatedAt: action.input.createdAt,
      };
    },
  };
