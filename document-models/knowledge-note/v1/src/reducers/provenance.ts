import type { KnowledgeNoteProvenanceOperations } from "@powerhousedao/knowledge-note/document-models/knowledge-note/v1";

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
