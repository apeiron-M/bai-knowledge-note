/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { baseActions } from "document-model";
import {
  knowledgeNoteContentActions,
  knowledgeNoteLifecycleActions,
  knowledgeNoteLinkingActions,
  knowledgeNoteLocalActions,
  knowledgeNoteProvenanceActions,
} from "./gen/creators.js";

/** Actions for the KnowledgeNote document model */

export const actions = {
  ...baseActions,
  ...knowledgeNoteContentActions,
  ...knowledgeNoteProvenanceActions,
  ...knowledgeNoteLinkingActions,
  ...knowledgeNoteLifecycleActions,
  ...knowledgeNoteLocalActions,
};
