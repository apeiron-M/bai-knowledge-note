/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  CreateGoalInput,
  DeleteGoalInput,
  ReorderInput,
  UpdateGoalDescriptionInput,
} from "../types.js";

export type CreateGoalAction = Action & {
  type: "CREATE_GOAL";
  input: CreateGoalInput;
};
export type UpdateGoalDescriptionAction = Action & {
  type: "UPDATE_GOAL_DESCRIPTION";
  input: UpdateGoalDescriptionInput;
};
export type DeleteGoalAction = Action & {
  type: "DELETE_GOAL";
  input: DeleteGoalInput;
};
export type ReorderAction = Action & { type: "REORDER"; input: ReorderInput };

export type WorkBreakdownStructureGoalsAction =
  | CreateGoalAction
  | UpdateGoalDescriptionAction
  | DeleteGoalAction
  | ReorderAction;
