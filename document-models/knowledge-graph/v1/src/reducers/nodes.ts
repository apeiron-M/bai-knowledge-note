import type { KnowledgeGraphNodesOperations } from "@powerhousedao/knowledge-note/document-models/knowledge-graph/v1";
import {
  DuplicateNodeError,
  NodeNotFoundError,
} from "../../gen/nodes/error.js";

export const knowledgeGraphNodesOperations: KnowledgeGraphNodesOperations = {
  addNodeOperation(state, action) {
    const existing = state.nodes.find(
      (n) => n.documentId === action.input.documentId,
    );
    if (existing) {
      throw new DuplicateNodeError("A node for this document already exists");
    }
    state.nodes.push({
      id: action.input.id,
      documentId: action.input.documentId,
      title: action.input.title || null,
      noteType: action.input.noteType || null,
      status: action.input.status || null,
    });
  },
  removeNodeOperation(state, action) {
    const nodeIndex = state.nodes.findIndex(
      (n) => n.documentId === action.input.documentId,
    );
    if (nodeIndex === -1) {
      throw new NodeNotFoundError("No node for this document");
    }
    state.nodes.splice(nodeIndex, 1);
    state.edges = state.edges.filter(
      (e) =>
        e.sourceDocumentId !== action.input.documentId &&
        e.targetDocumentId !== action.input.documentId,
    );
  },
  updateNodeOperation(state, action) {
    const node = state.nodes.find(
      (n) => n.documentId === action.input.documentId,
    );
    if (!node) {
      throw new NodeNotFoundError("No node for this document");
    }
    if (action.input.title) node.title = action.input.title;
    if (action.input.noteType) node.noteType = action.input.noteType;
    if (action.input.status) node.status = action.input.status;
  },
};
