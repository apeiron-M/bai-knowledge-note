/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { WorkBreakdownStructureGlobalState } from "../types.js";
import type {
  AddDependenciesAction,
  AssignGoalAction,
  RemoveDependenciesAction,
  SetGoalStatusAction,
  SetOutcomeAction,
} from "./actions.js";

export interface WorkBreakdownStructureWorkflowOperations {
  setGoalStatusOperation: (
    state: WorkBreakdownStructureGlobalState,
    action: SetGoalStatusAction,
    dispatch?: SignalDispatch,
  ) => void;
  assignGoalOperation: (
    state: WorkBreakdownStructureGlobalState,
    action: AssignGoalAction,
    dispatch?: SignalDispatch,
  ) => void;
  setOutcomeOperation: (
    state: WorkBreakdownStructureGlobalState,
    action: SetOutcomeAction,
    dispatch?: SignalDispatch,
  ) => void;
  addDependenciesOperation: (
    state: WorkBreakdownStructureGlobalState,
    action: AddDependenciesAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeDependenciesOperation: (
    state: WorkBreakdownStructureGlobalState,
    action: RemoveDependenciesAction,
    dispatch?: SignalDispatch,
  ) => void;
}
