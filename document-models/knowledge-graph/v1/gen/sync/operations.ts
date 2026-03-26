import { type SignalDispatch } from "document-model";
import type { SyncGraphAction } from "./actions.js";
import type { KnowledgeGraphState } from "../types.js";

export interface KnowledgeGraphSyncOperations {
  syncGraphOperation: (
    state: KnowledgeGraphState,
    action: SyncGraphAction,
    dispatch?: SignalDispatch,
  ) => void;
}
