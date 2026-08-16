/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { baseActions } from "document-model";
import {
  workBreakdownStructureDocumentationActions,
  workBreakdownStructureGoalsActions,
  workBreakdownStructureWorkflowActions,
} from "./gen/creators.js";

/** Actions for the WorkBreakdownStructure document model */

export const actions = {
  ...baseActions,
  ...workBreakdownStructureGoalsActions,
  ...workBreakdownStructureWorkflowActions,
  ...workBreakdownStructureDocumentationActions,
};
