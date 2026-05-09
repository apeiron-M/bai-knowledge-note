/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
import type { KnowledgeGraphAction } from "./actions.js";
import type { KnowledgeGraphState as KnowledgeGraphGlobalState } from "./schema/types.js";

type KnowledgeGraphLocalState = Record<PropertyKey, never>;

type KnowledgeGraphPHState = PHBaseState & {
  global: KnowledgeGraphGlobalState;
  local: KnowledgeGraphLocalState;
};
type KnowledgeGraphDocument = PHDocument<KnowledgeGraphPHState>;

export * from "./schema/types.js";

export type {
  KnowledgeGraphAction,
  KnowledgeGraphDocument,
  KnowledgeGraphGlobalState,
  KnowledgeGraphLocalState,
  KnowledgeGraphPHState,
};
