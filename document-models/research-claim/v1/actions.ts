import { baseActions } from "document-model";
import { claimManagementActions } from "./gen/creators.js";

/** Actions for the ResearchClaim document model */

export const actions = { ...baseActions, ...claimManagementActions };
