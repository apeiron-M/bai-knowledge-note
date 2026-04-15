import { baseActions } from "document-model";
import { sourceSourceManagementActions } from "./gen/creators.js";

/** Actions for the Source document model */

export const actions = { ...baseActions, ...sourceSourceManagementActions };
