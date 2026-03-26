import type { PHDocument, PHBaseState } from "document-model";
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
  KnowledgeGraphGlobalState,
  KnowledgeGraphLocalState,
  KnowledgeGraphPHState,
  KnowledgeGraphAction,
  KnowledgeGraphDocument,
};
