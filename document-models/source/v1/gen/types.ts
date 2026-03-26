import type { PHDocument, PHBaseState } from "document-model";
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
  SourceGlobalState,
  SourceLocalState,
  SourcePHState,
  SourceAction,
  SourceDocument,
};
