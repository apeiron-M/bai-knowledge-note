import { baseActions } from "document-model";
import {
  knowledgeGraphNodesActions,
  knowledgeGraphEdgesActions,
  knowledgeGraphSyncActions,
} from "./gen/creators.js";

/** Actions for the KnowledgeGraph document model */

export const actions = {
  ...baseActions,
  ...knowledgeGraphNodesActions,
  ...knowledgeGraphEdgesActions,
  ...knowledgeGraphSyncActions,
};
