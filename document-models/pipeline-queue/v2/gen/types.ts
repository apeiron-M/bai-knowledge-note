/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
import type { PipelineQueueAction } from "./actions.js";
import type { PipelineQueueState as PipelineQueueGlobalState } from "./schema/types.js";

type PipelineQueueLocalState = Record<PropertyKey, never>;

type PipelineQueuePHState = PHBaseState & {
  global: PipelineQueueGlobalState;
  local: PipelineQueueLocalState;
};
type PipelineQueueDocument = PHDocument<PipelineQueuePHState>;

export * from "./schema/types.js";

export type {
  PipelineQueueAction,
  PipelineQueueDocument,
  PipelineQueueGlobalState,
  PipelineQueueLocalState,
  PipelineQueuePHState,
};
