import { PHDocumentController } from "document-model";
import { Tension } from "../module.js";
import type { TensionAction, TensionPHState } from "./types.js";

export const TensionController = PHDocumentController.forDocumentModel<
  TensionPHState,
  TensionAction
>(Tension);
