import { PHDocumentController } from "document-model/core";
import { VaultConfig } from "../module.js";
import type { VaultConfigAction, VaultConfigPHState } from "./types.js";

export const VaultConfigController = PHDocumentController.forDocumentModel<
  VaultConfigPHState,
  VaultConfigAction
>(VaultConfig);
