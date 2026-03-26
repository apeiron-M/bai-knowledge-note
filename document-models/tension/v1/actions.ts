import { baseActions } from "document-model";
import { tensionManagementActions } from "./gen/creators.js";

/** Actions for the Tension document model */

export const actions = { ...baseActions, ...tensionManagementActions };
