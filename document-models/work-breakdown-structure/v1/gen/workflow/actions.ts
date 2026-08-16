/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddDependenciesInput,
  AssignGoalInput,
  RemoveDependenciesInput,
  SetGoalStatusInput,
  SetOutcomeInput,
} from "../types.js";

export type SetGoalStatusAction = Action & {
  type: "SET_GOAL_STATUS";
  input: SetGoalStatusInput;
};
export type AssignGoalAction = Action & {
  type: "ASSIGN_GOAL";
  input: AssignGoalInput;
};
export type SetOutcomeAction = Action & {
  type: "SET_OUTCOME";
  input: SetOutcomeInput;
};
export type AddDependenciesAction = Action & {
  type: "ADD_DEPENDENCIES";
  input: AddDependenciesInput;
};
export type RemoveDependenciesAction = Action & {
  type: "REMOVE_DEPENDENCIES";
  input: RemoveDependenciesInput;
};

export type WorkBreakdownStructureWorkflowAction =
  | SetGoalStatusAction
  | AssignGoalAction
  | SetOutcomeAction
  | AddDependenciesAction
  | RemoveDependenciesAction;
