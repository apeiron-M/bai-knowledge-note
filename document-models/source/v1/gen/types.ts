/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
import type { SourceAction } from "./actions.js";
import type { SourceState as SourceGlobalState } from "./schema/types.js";

type SourceLocalState = Record<PropertyKey, never>;

type SourcePHState = PHBaseState & {
  global: SourceGlobalState;
  local: SourceLocalState;
};
type SourceDocument = PHDocument<SourcePHState>;

export * from "./schema/types.js";

export type {
  SourceAction,
  SourceDocument,
  SourceGlobalState,
  SourceLocalState,
  SourcePHState,
};
