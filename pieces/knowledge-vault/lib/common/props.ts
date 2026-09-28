import { Property } from "@powerhousedao/pieces-framework";
import { knowledgeVaultAuth } from "../auth.js";
import { clientFor } from "./context.js";

/**
 * The vault drive a step acts on. Chosen per step, not per connection, so one
 * identity can serve several vaults. Filled from `GET drives`, which lists only
 * the vault drives the bearer may read.
 */
export const driveProp = Property.Dropdown({
  auth: knowledgeVaultAuth,
  displayName: "Vault",
  description: "The vault drive to act on",
  required: true,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return { disabled: true, placeholder: "Connect a Knowledge Vault first", options: [] };
    }
    try {
      const { drives } = await clientFor(auth).drives();
      return {
        disabled: false,
        placeholder: drives.length ? "Choose a vault" : "This identity can read no vault",
        options: drives.map((drive) => ({ label: drive.name, value: drive.id })),
      };
    } catch (error) {
      return {
        disabled: true,
        placeholder: `Could not list vaults: ${error instanceof Error ? error.message : String(error)}`,
        options: [],
      };
    }
  },
});
