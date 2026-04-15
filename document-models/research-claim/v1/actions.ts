import { baseActions } from "document-model";
import { researchClaimClaimManagementActions } from "./gen/creators.js";

/** Actions for the ResearchClaim document model */

export const actions = {
  ...baseActions,
  ...researchClaimClaimManagementActions,
};
