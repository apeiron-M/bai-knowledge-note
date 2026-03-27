import type { KnowledgeNoteLinkingOperations } from "@powerhousedao/knowledge-note/document-models/knowledge-note/v1";
import {
  DuplicateLinkIdError,
  LinkNotFoundError,
  DuplicateTopicError,
  TopicNotFoundError,
} from "../../gen/linking/error.js";

export const knowledgeNoteLinkingOperations: KnowledgeNoteLinkingOperations = {
  addLinkOperation(state, action) {
    const existing = state.links.find((l) => l.id === action.input.id);
    if (existing) {
      throw new DuplicateLinkIdError("A link with this OID already exists");
    }
    state.links.push({
      id: action.input.id,
      targetDocumentId: action.input.targetDocumentId,
      targetTitle: action.input.targetTitle || null,
      linkType: action.input.linkType,
    });
  },
  removeLinkOperation(state, action) {
    const index = state.links.findIndex((l) => l.id === action.input.id);
    if (index === -1) {
      throw new LinkNotFoundError("No link with this OID");
    }
    state.links.splice(index, 1);
  },
  updateLinkTypeOperation(state, action) {
    const link = state.links.find((l) => l.id === action.input.id);
    if (!link) {
      throw new LinkNotFoundError("No link with this OID");
    }
    link.linkType = action.input.linkType;
  },
  addTopicOperation(state, action) {
    const duplicate = state.topics.find((t) => t.name === action.input.name);
    if (duplicate) {
      throw new DuplicateTopicError(
        "A topic with this name already exists on this note",
      );
    }
    state.topics.push({
      id: action.input.id,
      name: action.input.name,
      topicDocumentId: action.input.topicDocumentId || null,
    });
  },
  removeTopicOperation(state, action) {
    const index = state.topics.findIndex((t) => t.id === action.input.id);
    if (index === -1) {
      throw new TopicNotFoundError("No topic with this OID");
    }
    state.topics.splice(index, 1);
  },
};
