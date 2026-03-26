import { baseActions } from "document-model";
import { reportManagementActions } from "./gen/creators.js";

/** Actions for the HealthReport document model */

export const actions = { ...baseActions, ...reportManagementActions };
