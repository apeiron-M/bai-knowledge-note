/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { WorkBreakdownStructureGlobalState } from "../types.js";
import type {
  CreateGoalAction,
  DeleteGoalAction,
  ReorderAction,
  UpdateGoalDescriptionAction,
} from "./actions.js";

export interface WorkBreakdownStructureGoalsOperations {
  createGoalOperation: (
    state: WorkBreakdownStructureGlobalState,
    action: CreateGoalAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateGoalDescriptionOperation: (
    state: WorkBreakdownStructureGlobalState,
    action: UpdateGoalDescriptionAction,
    dispatch?: SignalDispatch,
  ) => void;
  deleteGoalOperation: (
    state: WorkBreakdownStructureGlobalState,
    action: DeleteGoalAction,
    dispatch?: SignalDispatch,
  ) => void;
  reorderOperation: (
    state: WorkBreakdownStructureGlobalState,
    action: ReorderAction,
    dispatch?: SignalDispatch,
  ) => void;
}
