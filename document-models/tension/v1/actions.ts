import { baseActions } from "document-model";
import { tensionTensionManagementActions } from "./gen/creators.js";

/** Actions for the Tension document model */

export const actions = { ...baseActions, ...tensionTensionManagementActions };
