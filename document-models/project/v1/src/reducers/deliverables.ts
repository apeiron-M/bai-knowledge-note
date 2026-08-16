import type { ProjectDeliverablesOperations } from "document-models/project/v1";
import {
  DuplicateDeliverableError,
  DeliverableNotFoundError,
} from "../../gen/deliverables/error.js";

export const projectDeliverablesOperations: ProjectDeliverablesOperations = {
  addDeliverableOperation(state, action) {
    if (state.deliverables.some((d) => d.id === action.input.id))
      throw new DuplicateDeliverableError("Deliverable already exists");
    state.deliverables.push({
      id: action.input.id, title: action.input.title,
      description: action.input.description || null, status: "PLANNED",
      goalRef: action.input.goalRef || null, url: action.input.url || null,
      deliveredAt: null,
    });
  },
  updateDeliverableOperation(state, action) {
    const d = state.deliverables.find((d) => d.id === action.input.id);
    if (!d) throw new DeliverableNotFoundError("Deliverable not found");
    if (action.input.title) d.title = action.input.title;
    if (action.input.description) d.description = action.input.description;
    if (action.input.goalRef) d.goalRef = action.input.goalRef;
    if (action.input.url) d.url = action.input.url;
  },
  setDeliverableStatusOperation(state, action) {
    const d = state.deliverables.find((d) => d.id === action.input.id);
    if (!d) throw new DeliverableNotFoundError("Deliverable not found");
    d.status = action.input.status;
    d.deliveredAt = action.input.status === "DELIVERED"
      ? action.input.deliveredAt || d.deliveredAt || null
      : null;
  },
  removeDeliverableOperation(state, action) {
    const i = state.deliverables.findIndex((d) => d.id === action.input.id);
    if (i === -1) throw new DeliverableNotFoundError("Deliverable not found");
    state.deliverables.splice(i, 1);
  },
};
