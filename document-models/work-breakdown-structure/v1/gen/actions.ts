/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { WorkBreakdownStructureDocumentationAction } from "./documentation/actions.js";
import type { WorkBreakdownStructureGoalsAction } from "./goals/actions.js";
import type { WorkBreakdownStructureWorkflowAction } from "./workflow/actions.js";

export * from "./documentation/actions.js";
export * from "./goals/actions.js";
export * from "./workflow/actions.js";

export type WorkBreakdownStructureAction =
  | WorkBreakdownStructureGoalsAction
  | WorkBreakdownStructureWorkflowAction
  | WorkBreakdownStructureDocumentationAction;
