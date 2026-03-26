import { baseActions } from "document-model";
import { mocManagementActions } from "./gen/creators.js";

/** Actions for the Moc document model */

export const actions = { ...baseActions, ...mocManagementActions };
