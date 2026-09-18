/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
import type { KnowledgeNoteAction } from "./actions.js";
import type {
  KnowledgeNoteState as KnowledgeNoteGlobalState,
  KnowledgeNoteLocalState,
} from "./schema/types.js";

type KnowledgeNotePHState = PHBaseState & {
  global: KnowledgeNoteGlobalState;
  local: KnowledgeNoteLocalState;
};
type KnowledgeNoteDocument = PHDocument<KnowledgeNotePHState>;

export * from "./schema/types.js";

export type {
  KnowledgeNoteAction,
  KnowledgeNoteDocument,
  KnowledgeNoteGlobalState,
  KnowledgeNoteLocalState,
  KnowledgeNotePHState,
};
