/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
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
  ResearchClaimAction,
  ResearchClaimDocument,
  ResearchClaimGlobalState,
  ResearchClaimLocalState,
  ResearchClaimPHState,
};
