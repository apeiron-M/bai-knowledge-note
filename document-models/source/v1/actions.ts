import { baseActions } from "document-model";
import { sourceManagementActions } from "./gen/creators.js";

/** Actions for the Source document model */

export const actions = { ...baseActions, ...sourceManagementActions };
