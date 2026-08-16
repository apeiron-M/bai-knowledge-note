/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  CreateProjectInput,
  LinkWbsInput,
  SetOwnerInput,
  SetProjectStatusInput,
  SetTargetDateInput,
  UpdateProjectInfoInput,
} from "../types.js";

export type CreateProjectAction = Action & {
  type: "CREATE_PROJECT";
  input: CreateProjectInput;
};
export type UpdateProjectInfoAction = Action & {
  type: "UPDATE_PROJECT_INFO";
  input: UpdateProjectInfoInput;
};
export type SetProjectStatusAction = Action & {
  type: "SET_PROJECT_STATUS";
  input: SetProjectStatusInput;
};
export type SetOwnerAction = Action & {
  type: "SET_OWNER";
  input: SetOwnerInput;
};
export type SetTargetDateAction = Action & {
  type: "SET_TARGET_DATE";
  input: SetTargetDateInput;
};
export type LinkWbsAction = Action & { type: "LINK_WBS"; input: LinkWbsInput };

export type ProjectLifecycleAction =
  | CreateProjectAction
  | UpdateProjectInfoAction
  | SetProjectStatusAction
  | SetOwnerAction
  | SetTargetDateAction
  | LinkWbsAction;
