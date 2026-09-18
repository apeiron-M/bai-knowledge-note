/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action, PHDocument, UpgradeTransition } from "document-model";
import type { SourcePHState as StateV1 } from "document-models/source/v1";
import type { SourcePHState as StateV2 } from "document-models/source/v2";

const addedGlobalFields = {
  attachments: [],
  originalFile: null,
  originalFileName: null,
  originalMimeType: null,
  originalSizeBytes: null,
  originalAttachedAt: null,
  convertedBy: null,
} satisfies Partial<StateV2["global"]>;

/*
 * Fields added in v2 are initialized from the new version's initial
 * value (or the schema's zero value); existing data wins for every field
 * that already existed. Both state and initialState are migrated so a
 * rebuild from the operation log converges with the stored state.
 */
function upgradeReducer(
  document: PHDocument<StateV1>,
  action: Action,
): PHDocument<StateV2> {
  return {
    ...document,
    state: {
      ...document.state,
      global: { ...addedGlobalFields, ...document.state.global },
    },
    initialState: {
      ...document.initialState,
      global: { ...addedGlobalFields, ...document.initialState.global },
    },
  };
}

export const v2: UpgradeTransition = {
  toVersion: 2,
  upgradeReducer,
  description: "",
};
