import type { TensionTensionManagementOperations } from "knowledge-note/document-models/tension/v1";
import { TensionAlreadyResolvedError } from "../../gen/tension-management/error.js";

export const tensionTensionManagementOperations: TensionTensionManagementOperations =
  {
    createTensionOperation(state, action) {
      state.title = action.input.title;
      state.description = action.input.description;
      state.content = action.input.content || null;
      state.involvedRefs = action.input.involvedRefs;
      state.status = "OPEN";
      state.observedAt = action.input.observedAt;
      state.observedBy = action.input.observedBy || null;
    },
    resolveTensionOperation(state, action) {
      if (state.status !== "OPEN")
        throw new TensionAlreadyResolvedError("Tension is not open");
      state.status = "RESOLVED";
      state.resolution = action.input.resolution;
      state.resolvedAt = action.input.resolvedAt;
    },
    dissolveTensionOperation(state, action) {
      if (state.status !== "OPEN")
        throw new TensionAlreadyResolvedError("Tension is not open");
      state.status = "DISSOLVED";
      state.resolution = action.input.resolution;
      state.resolvedAt = action.input.resolvedAt;
    },
    addInvolvedRefOperation(state, action) {
      if (!state.involvedRefs.includes(action.input.ref)) {
        state.involvedRefs.push(action.input.ref);
      }
    },
  };
