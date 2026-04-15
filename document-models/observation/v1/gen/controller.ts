import { PHDocumentController } from "document-model";
import { Observation } from "../module.js";
import type { ObservationAction, ObservationPHState } from "./types.js";

export const ObservationController = PHDocumentController.forDocumentModel<
  ObservationPHState,
  ObservationAction
>(Observation);
