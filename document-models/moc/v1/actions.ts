import { baseActions } from "document-model";
import { mocMocManagementActions } from "./gen/creators.js";

/** Actions for the Moc document model */

export const actions = { ...baseActions, ...mocMocManagementActions };
