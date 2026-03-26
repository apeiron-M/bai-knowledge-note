import { baseActions } from "document-model";
import { nodesActions, edgesActions, syncActions } from "./gen/creators.js";

/** Actions for the KnowledgeGraph document model */

export const actions = {
  ...baseActions,
  ...nodesActions,
  ...edgesActions,
  ...syncActions,
};
