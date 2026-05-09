/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
import type { TensionAction } from "./actions.js";
import type { TensionState as TensionGlobalState } from "./schema/types.js";

type TensionLocalState = Record<PropertyKey, never>;

type TensionPHState = PHBaseState & {
  global: TensionGlobalState;
  local: TensionLocalState;
};
type TensionDocument = PHDocument<TensionPHState>;

export * from "./schema/types.js";

export type {
  TensionAction,
  TensionDocument,
  TensionGlobalState,
  TensionLocalState,
  TensionPHState,
};
