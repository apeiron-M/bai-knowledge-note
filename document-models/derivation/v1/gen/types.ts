import type { PHDocument, PHBaseState } from "document-model";
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
  DerivationGlobalState,
  DerivationLocalState,
  DerivationPHState,
  DerivationAction,
  DerivationDocument,
};
