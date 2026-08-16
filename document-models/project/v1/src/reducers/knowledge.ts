import type { ProjectKnowledgeOperations } from "document-models/project/v1";
import {
  DuplicateKnowledgeRefError,
  KnowledgeRefNotFoundError,
} from "../../gen/knowledge/error.js";

export const projectKnowledgeOperations: ProjectKnowledgeOperations = {
  addKnowledgeRefOperation(state, action) {
    if (state.knowledgeRefs.includes(action.input.ref))
      throw new DuplicateKnowledgeRefError("Knowledge ref already linked");
    state.knowledgeRefs.push(action.input.ref);
  },
  removeKnowledgeRefOperation(state, action) {
    const i = state.knowledgeRefs.indexOf(action.input.ref);
    if (i === -1) throw new KnowledgeRefNotFoundError("Knowledge ref not linked");
    state.knowledgeRefs.splice(i, 1);
  },
  setReferencesOperation(state, action) { state.references = action.input.references; },
};
