import type { DocumentModelUtils } from "document-model";
import type { PipelineQueuePHState } from "./gen/types.js";
import { utils as genUtils } from "./gen/utils.js";
import * as customUtils from "./src/utils.js";

/** Utils for the PipelineQueue document model */
export const utils: DocumentModelUtils<PipelineQueuePHState> = {
  ...genUtils,
  ...customUtils,
};
