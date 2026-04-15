import type { DocumentModelUtils } from "document-model";
import type { DerivationPHState } from "./gen/types.js";
import { utils as genUtils } from "./gen/utils.js";
import * as customUtils from "./src/utils.js";

/** Utils for the Derivation document model */
export const utils: DocumentModelUtils<DerivationPHState> = {
  ...genUtils,
  ...customUtils,
};
