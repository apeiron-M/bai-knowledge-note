import { baseActions } from "document-model";
import { vaultConfigConfigManagementActions } from "./gen/creators.js";

/** Actions for the VaultConfig document model */

export const actions = {
  ...baseActions,
  ...vaultConfigConfigManagementActions,
};
