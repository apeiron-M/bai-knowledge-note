/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddDeliverableInput,
  RemoveDeliverableInput,
  SetDeliverableStatusInput,
  UpdateDeliverableInput,
} from "../types.js";

export type AddDeliverableAction = Action & {
  type: "ADD_DELIVERABLE";
  input: AddDeliverableInput;
};
export type UpdateDeliverableAction = Action & {
  type: "UPDATE_DELIVERABLE";
  input: UpdateDeliverableInput;
};
export type SetDeliverableStatusAction = Action & {
  type: "SET_DELIVERABLE_STATUS";
  input: SetDeliverableStatusInput;
};
export type RemoveDeliverableAction = Action & {
  type: "REMOVE_DELIVERABLE";
  input: RemoveDeliverableInput;
};

export type ProjectDeliverablesAction =
  | AddDeliverableAction
  | UpdateDeliverableAction
  | SetDeliverableStatusAction
  | RemoveDeliverableAction;
