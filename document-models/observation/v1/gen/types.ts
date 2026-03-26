import type { PHDocument, PHBaseState } from "document-model";
import type { ObservationAction } from "./actions.js";
import type { ObservationState as ObservationGlobalState } from "./schema/types.js";

type ObservationLocalState = Record<PropertyKey, never>;

type ObservationPHState = PHBaseState & {
  global: ObservationGlobalState;
  local: ObservationLocalState;
};
type ObservationDocument = PHDocument<ObservationPHState>;

export * from "./schema/types.js";

export type {
  ObservationGlobalState,
  ObservationLocalState,
  ObservationPHState,
  ObservationAction,
  ObservationDocument,
};
