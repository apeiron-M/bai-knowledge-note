/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { baseActions } from "document-model";
import {
  projectDeliverablesActions,
  projectKnowledgeActions,
  projectLifecycleActions,
  projectTeamActions,
} from "./gen/creators.js";

/** Actions for the Project document model */

export const actions = {
  ...baseActions,
  ...projectLifecycleActions,
  ...projectTeamActions,
  ...projectDeliverablesActions,
  ...projectKnowledgeActions,
};
