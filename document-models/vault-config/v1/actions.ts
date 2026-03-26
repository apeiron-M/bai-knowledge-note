import { baseActions } from "document-model";
import { configManagementActions } from "./gen/creators.js";

/** Actions for the VaultConfig document model */

export const actions = { ...baseActions, ...configManagementActions };
