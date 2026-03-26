import { PHDocumentController } from "document-model/core";
import { Derivation } from "../module.js";
import type { DerivationAction, DerivationPHState } from "./types.js";

export const DerivationController = PHDocumentController.forDocumentModel<
  DerivationPHState,
  DerivationAction
>(Derivation);
