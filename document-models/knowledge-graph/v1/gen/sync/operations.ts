/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { KnowledgeGraphGlobalState } from "../types.js";
import type { SyncGraphAction } from "./actions.js";

export interface KnowledgeGraphSyncOperations {
  syncGraphOperation: (
    state: KnowledgeGraphGlobalState,
    action: SyncGraphAction,
    dispatch?: SignalDispatch,
  ) => void;
}
