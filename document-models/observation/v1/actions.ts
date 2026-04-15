import { baseActions } from "document-model";
import { observationObservationManagementActions } from "./gen/creators.js";

/** Actions for the Observation document model */

export const actions = {
  ...baseActions,
  ...observationObservationManagementActions,
};
