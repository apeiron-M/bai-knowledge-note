/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
import type { DerivationAction } from "./actions.js";
import type { DerivationState as DerivationGlobalState } from "./schema/types.js";

type DerivationLocalState = Record<PropertyKey, never>;

type DerivationPHState = PHBaseState & {
  global: DerivationGlobalState;
  local: DerivationLocalState;
};
type DerivationDocument = PHDocument<DerivationPHState>;

export * from "./schema/types.js";

export type {
  DerivationAction,
  DerivationDocument,
  DerivationGlobalState,
  DerivationLocalState,
  DerivationPHState,
};
