/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { baseActions } from "document-model";
import {
  knowledgeGraphEdgesActions,
  knowledgeGraphNodesActions,
  knowledgeGraphSyncActions,
} from "./gen/creators.js";

/** Actions for the KnowledgeGraph document model */

export const actions = {
  ...baseActions,
  ...knowledgeGraphNodesActions,
  ...knowledgeGraphEdgesActions,
  ...knowledgeGraphSyncActions,
};
