import type { PHDocument, PHBaseState } from "document-model";
import type { ResearchClaimAction } from "./actions.js";
import type { ResearchClaimState as ResearchClaimGlobalState } from "./schema/types.js";

type ResearchClaimLocalState = Record<PropertyKey, never>;

type ResearchClaimPHState = PHBaseState & {
  global: ResearchClaimGlobalState;
  local: ResearchClaimLocalState;
};
type ResearchClaimDocument = PHDocument<ResearchClaimPHState>;

export * from "./schema/types.js";

export type {
  ResearchClaimGlobalState,
  ResearchClaimLocalState,
  ResearchClaimPHState,
  ResearchClaimAction,
  ResearchClaimDocument,
};
