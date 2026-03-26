import { type SignalDispatch } from "document-model";
import type {
  AddTaskAction,
  AssignTaskAction,
  AdvancePhaseAction,
  CompleteTaskAction,
  FailTaskAction,
  BlockTaskAction,
  UnblockTaskAction,
} from "./actions.js";
import type { PipelineQueueState } from "../types.js";

export interface PipelineQueueQueueManagementOperations {
  addTaskOperation: (
    state: PipelineQueueState,
    action: AddTaskAction,
    dispatch?: SignalDispatch,
  ) => void;
  assignTaskOperation: (
    state: PipelineQueueState,
    action: AssignTaskAction,
    dispatch?: SignalDispatch,
  ) => void;
  advancePhaseOperation: (
    state: PipelineQueueState,
    action: AdvancePhaseAction,
    dispatch?: SignalDispatch,
  ) => void;
  completeTaskOperation: (
    state: PipelineQueueState,
    action: CompleteTaskAction,
    dispatch?: SignalDispatch,
  ) => void;
  failTaskOperation: (
    state: PipelineQueueState,
    action: FailTaskAction,
    dispatch?: SignalDispatch,
  ) => void;
  blockTaskOperation: (
    state: PipelineQueueState,
    action: BlockTaskAction,
    dispatch?: SignalDispatch,
  ) => void;
  unblockTaskOperation: (
    state: PipelineQueueState,
    action: UnblockTaskAction,
    dispatch?: SignalDispatch,
  ) => void;
}
