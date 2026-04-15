import type { DocumentModelUtils } from "document-model";
import type { ResearchClaimPHState } from "./gen/types.js";
import { utils as genUtils } from "./gen/utils.js";
import * as customUtils from "./src/utils.js";

/** Utils for the ResearchClaim document model */
export const utils: DocumentModelUtils<ResearchClaimPHState> = {
  ...genUtils,
  ...customUtils,
};
