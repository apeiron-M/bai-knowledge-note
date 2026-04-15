import type { ResearchClaimClaimManagementOperations } from "document-models/research-claim/v1";

export const researchClaimClaimManagementOperations: ResearchClaimClaimManagementOperations =
  {
    createClaimOperation(state, action) {
      state.title = action.input.title;
      state.description = action.input.description;
      state.content = action.input.content;
      state.kind = action.input.kind;
      state.methodology = action.input.methodology;
      state.sources = action.input.sources;
      state.topics = action.input.topics;
    },
    addResearchConnectionOperation(state, action) {
      state.connections.push({
        id: action.input.id,
        targetRef: action.input.targetRef,
        contextPhrase: action.input.contextPhrase,
      });
    },
    removeResearchConnectionOperation(state, action) {
      state.connections = state.connections.filter(
        (c) => c.id !== action.input.id,
      );
    },
    updateClaimContentOperation(state, action) {
      state.content = action.input.content;
    },
  };
