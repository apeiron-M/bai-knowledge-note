/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddInvolvedRefInput,
  CreateTensionInput,
  DissolveTensionInput,
  ResolveTensionInput,
} from "../types.js";

export type CreateTensionAction = Action & {
  type: "CREATE_TENSION";
  input: CreateTensionInput;
};
export type ResolveTensionAction = Action & {
  type: "RESOLVE_TENSION";
  input: ResolveTensionInput;
};
export type DissolveTensionAction = Action & {
  type: "DISSOLVE_TENSION";
  input: DissolveTensionInput;
};
export type AddInvolvedRefAction = Action & {
  type: "ADD_INVOLVED_REF";
  input: AddInvolvedRefInput;
};

export type TensionTensionManagementAction =
  | CreateTensionAction
  | ResolveTensionAction
  | DissolveTensionAction
  | AddInvolvedRefAction;
