import type { PHDocument, PHBaseState } from "document-model";
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
  TensionGlobalState,
  TensionLocalState,
  TensionPHState,
  TensionAction,
  TensionDocument,
};
