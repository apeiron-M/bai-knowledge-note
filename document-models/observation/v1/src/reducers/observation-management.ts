import type { ObservationObservationManagementOperations } from "document-models/observation/v1";

export const observationObservationManagementOperations: ObservationObservationManagementOperations =
  {
    createObservationOperation(state, action) {
      state.title = action.input.title;
      state.description = action.input.description;
      state.content = action.input.content || null;
      state.category = action.input.category;
      state.status = "PENDING";
      state.observedAt = action.input.observedAt;
      state.observedBy = action.input.observedBy || null;
    },
    promoteObservationOperation(state, action) {
      state.status = "PROMOTED";
      state.promotedTo = action.input.promotedTo;
      state.promotedAt = action.input.promotedAt;
    },
    implementObservationOperation(state, action) {
      state.status = "IMPLEMENTED";
    },
    archiveObservationOperation(state, action) {
      state.status = "ARCHIVED";
    },
  };
