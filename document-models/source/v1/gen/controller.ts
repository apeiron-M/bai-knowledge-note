import { PHDocumentController } from "document-model/core";
import { Source } from "../module.js";
import type { SourceAction, SourcePHState } from "./types.js";

export const SourceController = PHDocumentController.forDocumentModel<
  SourcePHState,
  SourceAction
>(Source);
