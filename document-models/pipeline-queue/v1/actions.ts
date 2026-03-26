import { baseActions } from "document-model";
import { queueManagementActions } from "./gen/creators.js";

/** Actions for the PipelineQueue document model */

export const actions = { ...baseActions, ...queueManagementActions };
