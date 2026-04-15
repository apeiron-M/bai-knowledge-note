import type { DocumentModelUtils } from "document-model";
import type { TensionPHState } from "./gen/types.js";
import { utils as genUtils } from "./gen/utils.js";
import * as customUtils from "./src/utils.js";

/** Utils for the Tension document model */
export const utils: DocumentModelUtils<TensionPHState> = {
  ...genUtils,
  ...customUtils,
};
