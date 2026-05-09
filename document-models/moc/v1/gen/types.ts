/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
import type { MocAction } from "./actions.js";
import type { MocState as MocGlobalState } from "./schema/types.js";

type MocLocalState = Record<PropertyKey, never>;

type MocPHState = PHBaseState & {
  global: MocGlobalState;
  local: MocLocalState;
};
type MocDocument = PHDocument<MocPHState>;

export * from "./schema/types.js";

export type {
  MocAction,
  MocDocument,
  MocGlobalState,
  MocLocalState,
  MocPHState,
};
