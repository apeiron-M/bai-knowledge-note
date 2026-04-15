import { baseActions } from "document-model";
import {
  knowledgeNoteContentActions,
  knowledgeNoteProvenanceActions,
  knowledgeNoteLinkingActions,
  knowledgeNoteLifecycleActions,
  knowledgeNoteLocalActions,
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
