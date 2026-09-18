/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { PipelineQueueGlobalState } from "../types.js";
import type {
  AddTaskAction,
  AdvancePhaseAction,
  AssignTaskAction,
  BlockTaskAction,
  CompleteTaskAction,
  FailTaskAction,
  UnblockTaskAction,
} from "./actions.js";

export interface PipelineQueueQueueManagementOperations {
  addTaskOperation: (
    state: PipelineQueueGlobalState,
    action: AddTaskAction,
    dispatch?: SignalDispatch,
  ) => void;
  assignTaskOperation: (
    state: PipelineQueueGlobalState,
    action: AssignTaskAction,
    dispatch?: SignalDispatch,
  ) => void;
  advancePhaseOperation: (
    state: PipelineQueueGlobalState,
    action: AdvancePhaseAction,
    dispatch?: SignalDispatch,
  ) => void;
  completeTaskOperation: (
    state: PipelineQueueGlobalState,
    action: CompleteTaskAction,
    dispatch?: SignalDispatch,
  ) => void;
  failTaskOperation: (
    state: PipelineQueueGlobalState,
    action: FailTaskAction,
    dispatch?: SignalDispatch,
  ) => void;
  blockTaskOperation: (
    state: PipelineQueueGlobalState,
    action: BlockTaskAction,
    dispatch?: SignalDispatch,
  ) => void;
  unblockTaskOperation: (
    state: PipelineQueueGlobalState,
    action: UnblockTaskAction,
    dispatch?: SignalDispatch,
  ) => void;
}
