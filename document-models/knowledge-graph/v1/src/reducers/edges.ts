import {
  DuplicateEdgeError,
  EdgeNotFoundError,
} from "../../gen/edges/error.js";
import type { KnowledgeGraphEdgesOperations } from "document-models/knowledge-graph/v1";

export const knowledgeGraphEdgesOperations: KnowledgeGraphEdgesOperations = {
  addEdgeOperation(state, action) {
    const existing = state.edges.find(
      (e) =>
        e.sourceDocumentId === action.input.sourceDocumentId &&
        e.targetDocumentId === action.input.targetDocumentId &&
        e.linkType === (action.input.linkType || null),
    );
    if (existing) {
      throw new DuplicateEdgeError("This edge already exists");
    }
    state.edges.push({
      id: action.input.id,
      sourceDocumentId: action.input.sourceDocumentId,
      targetDocumentId: action.input.targetDocumentId,
      linkType: action.input.linkType || null,
    });
  },
  removeEdgeOperation(state, action) {
    const index = state.edges.findIndex((e) => e.id === action.input.id);
    if (index === -1) {
      throw new EdgeNotFoundError("No edge with this ID");
    }
    state.edges.splice(index, 1);
  },
  updateEdgeOperation(state, action) {
    const edge = state.edges.find((e) => e.id === action.input.id);
    if (!edge) {
      throw new EdgeNotFoundError("No edge with this ID");
    }
    if (action.input.linkType) edge.linkType = action.input.linkType;
  },
};
