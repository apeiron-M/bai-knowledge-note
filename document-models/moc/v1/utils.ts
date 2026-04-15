import type { DocumentModelUtils } from "document-model";
import type { MocPHState } from "./gen/types.js";
import { utils as genUtils } from "./gen/utils.js";
import * as customUtils from "./src/utils.js";

/** Utils for the Moc document model */
export const utils: DocumentModelUtils<MocPHState> = {
  ...genUtils,
  ...customUtils,
};
