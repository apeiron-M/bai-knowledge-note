import type { ObservationObservationManagementOperations } from "document-models/observation/v1";
import { InvalidObservationTransitionError } from "../../gen/observation-management/error.js";

// Lifecycle: PENDING → PROMOTED → IMPLEMENTED, or → ARCHIVED from any
// non-archived state. Mirrors the tension reducer's OPEN-only guards.
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
      if (state.status !== "PENDING") {
        throw new InvalidObservationTransitionError(
          `Only a PENDING observation can be promoted (status is ${state.status})`,
        );
      }
      state.status = "PROMOTED";
      state.promotedTo = action.input.promotedTo;
      state.promotedAt = action.input.promotedAt;
    },
    implementObservationOperation(state) {
      if (state.status !== "PROMOTED") {
        throw new InvalidObservationTransitionError(
          `Only a PROMOTED observation can be implemented (status is ${state.status})`,
        );
      }
      state.status = "IMPLEMENTED";
    },
    archiveObservationOperation(state) {
      if (state.status === "ARCHIVED") {
        throw new InvalidObservationTransitionError(
          "Observation is already archived",
        );
      }
      state.status = "ARCHIVED";
    },
  };
