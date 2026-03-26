import { baseActions } from "document-model";
import { observationManagementActions } from "./gen/creators.js";

/** Actions for the Observation document model */

export const actions = { ...baseActions, ...observationManagementActions };
