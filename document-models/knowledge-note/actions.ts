import { baseActions } from "document-model";
import {
  contentActions,
  provenanceActions,
  linkingActions,
  lifecycleActions,
  localActions,
} from "./gen/creators.js";

/** Actions for the KnowledgeNote document model */

export const actions = {
  ...baseActions,
  ...contentActions,
  ...provenanceActions,
  ...linkingActions,
  ...lifecycleActions,
  ...localActions,
};
