/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
import type { VaultConfigAction } from "./actions.js";
import type { VaultConfigState as VaultConfigGlobalState } from "./schema/types.js";

type VaultConfigLocalState = Record<PropertyKey, never>;

type VaultConfigPHState = PHBaseState & {
  global: VaultConfigGlobalState;
  local: VaultConfigLocalState;
};
type VaultConfigDocument = PHDocument<VaultConfigPHState>;

export * from "./schema/types.js";

export type {
  VaultConfigAction,
  VaultConfigDocument,
  VaultConfigGlobalState,
  VaultConfigLocalState,
  VaultConfigPHState,
};
