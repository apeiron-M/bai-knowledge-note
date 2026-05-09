/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { KnowledgeGraphEdgesAction } from "./edges/actions.js";
import type { KnowledgeGraphNodesAction } from "./nodes/actions.js";
import type { KnowledgeGraphSyncAction } from "./sync/actions.js";

export * from "./edges/actions.js";
export * from "./nodes/actions.js";
export * from "./sync/actions.js";

export type KnowledgeGraphAction =
  | KnowledgeGraphNodesAction
  | KnowledgeGraphEdgesAction
  | KnowledgeGraphSyncAction;
