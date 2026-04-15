import { PHDocumentController } from "document-model";
import { KnowledgeNote } from "../module.js";
import type { KnowledgeNoteAction, KnowledgeNotePHState } from "./types.js";

export const KnowledgeNoteController = PHDocumentController.forDocumentModel<
  KnowledgeNotePHState,
  KnowledgeNoteAction
>(KnowledgeNote);
