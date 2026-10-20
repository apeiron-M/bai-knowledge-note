/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action, PHDocument, UpgradeTransition } from "document-model";
import type { VaultConfigPHState as StateV1 } from "document-models/vault-config/v1";
import type { VaultConfigPHState as StateV2 } from "document-models/vault-config/v2";

/*
 * No fields were added between v1 and v2, so existing state
 * carries over unchanged.
 */
function upgradeReducer(
  document: PHDocument<StateV1>,
  action: Action,
): PHDocument<StateV2> {
  return {
    ...document,
  };
}

export const v2: UpgradeTransition = {
  toVersion: 2,
  upgradeReducer,
  description: "",
};
