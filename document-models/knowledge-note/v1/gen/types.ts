import type { PHDocument, PHBaseState } from "document-model";
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
  KnowledgeNoteGlobalState,
  KnowledgeNoteLocalState,
  KnowledgeNotePHState,
  KnowledgeNoteAction,
  KnowledgeNoteDocument,
};
