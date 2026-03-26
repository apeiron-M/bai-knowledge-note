import type { KnowledgeGraphSyncOperations } from "knowledge-note/document-models/knowledge-graph/v1";

export const knowledgeGraphSyncOperations: KnowledgeGraphSyncOperations = {
  syncGraphOperation(state, action) {
    state.nodes = action.input.nodes.map((n) => ({
      id: n.id,
      documentId: n.documentId,
      title: n.title || null,
      noteType: n.noteType || null,
      status: n.status || null,
    }));
    state.edges = action.input.edges.map((e) => ({
      id: e.id,
      sourceDocumentId: e.sourceDocumentId,
      targetDocumentId: e.targetDocumentId,
      linkType: e.linkType || null,
    }));
    state.lastSyncedAt = action.input.syncedAt;
  },
};
