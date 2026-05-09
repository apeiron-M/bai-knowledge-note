/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type { SyncGraphInput } from "../types.js";

export type SyncGraphAction = Action & {
  type: "SYNC_GRAPH";
  input: SyncGraphInput;
};

export type KnowledgeGraphSyncAction = SyncGraphAction;
