import { baseActions } from "document-model";
import { derivationManagementActions } from "./gen/creators.js";

/** Actions for the Derivation document model */

export const actions = { ...baseActions, ...derivationManagementActions };
