import type { ProjectLifecycleOperations } from "document-models/project/v1";
import { AlreadyInitializedError } from "../../gen/lifecycle/error.js";

export const projectLifecycleOperations: ProjectLifecycleOperations = {
  createProjectOperation(state, action) {
    if (state.name) throw new AlreadyInitializedError("Project already initialized");
    state.name = action.input.name;
    state.description = action.input.description || null;
    state.owner = action.input.owner || null;
    if (action.input.status) state.status = action.input.status;
    state.createdAt = action.input.createdAt;
  },
  updateProjectInfoOperation(state, action) {
    if (action.input.name) state.name = action.input.name;
    if (action.input.description) state.description = action.input.description;
  },
  setProjectStatusOperation(state, action) { state.status = action.input.status; },
  setOwnerOperation(state, action) { state.owner = action.input.owner || null; },
  setTargetDateOperation(state, action) { state.targetDate = action.input.targetDate || null; },
  linkWbsOperation(state, action) { state.wbsRef = action.input.wbsRef || null; },
};
