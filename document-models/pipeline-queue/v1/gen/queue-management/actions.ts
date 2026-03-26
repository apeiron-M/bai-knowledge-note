import type { Action } from "document-model";
import type {
  AddTaskInput,
  AssignTaskInput,
  AdvancePhaseInput,
  CompleteTaskInput,
  FailTaskInput,
  BlockTaskInput,
  UnblockTaskInput,
} from "../types.js";

export type AddTaskAction = Action & { type: "ADD_TASK"; input: AddTaskInput };
export type AssignTaskAction = Action & {
  type: "ASSIGN_TASK";
  input: AssignTaskInput;
};
export type AdvancePhaseAction = Action & {
  type: "ADVANCE_PHASE";
  input: AdvancePhaseInput;
};
export type CompleteTaskAction = Action & {
  type: "COMPLETE_TASK";
  input: CompleteTaskInput;
};
export type FailTaskAction = Action & {
  type: "FAIL_TASK";
  input: FailTaskInput;
};
export type BlockTaskAction = Action & {
  type: "BLOCK_TASK";
  input: BlockTaskInput;
};
export type UnblockTaskAction = Action & {
  type: "UNBLOCK_TASK";
  input: UnblockTaskInput;
};

export type PipelineQueueQueueManagementAction =
  | AddTaskAction
  | AssignTaskAction
  | AdvancePhaseAction
  | CompleteTaskAction
  | FailTaskAction
  | BlockTaskAction
  | UnblockTaskAction;
