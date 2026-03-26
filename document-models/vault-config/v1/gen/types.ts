import type { PHDocument, PHBaseState } from "document-model";
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
  VaultConfigGlobalState,
  VaultConfigLocalState,
  VaultConfigPHState,
  VaultConfigAction,
  VaultConfigDocument,
};
