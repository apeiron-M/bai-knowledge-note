import type { Action } from "document-model";
import type {
  CreateMocInput,
  UpdateOrientationInput,
  UpdateDescriptionInput,
  AddCoreIdeaInput,
  UpdateCoreIdeaInput,
  RemoveCoreIdeaInput,
  ReorderCoreIdeasInput,
  AddTensionInput,
  RemoveTensionInput,
  AddOpenQuestionInput,
  RemoveOpenQuestionInput,
  AddChildMocInput,
  RemoveChildMocInput,
} from "../types.js";

export type CreateMocAction = Action & {
  type: "CREATE_MOC";
  input: CreateMocInput;
};
export type UpdateOrientationAction = Action & {
  type: "UPDATE_ORIENTATION";
  input: UpdateOrientationInput;
};
export type UpdateDescriptionAction = Action & {
  type: "UPDATE_DESCRIPTION";
  input: UpdateDescriptionInput;
};
export type AddCoreIdeaAction = Action & {
  type: "ADD_CORE_IDEA";
  input: AddCoreIdeaInput;
};
export type UpdateCoreIdeaAction = Action & {
  type: "UPDATE_CORE_IDEA";
  input: UpdateCoreIdeaInput;
};
export type RemoveCoreIdeaAction = Action & {
  type: "REMOVE_CORE_IDEA";
  input: RemoveCoreIdeaInput;
};
export type ReorderCoreIdeasAction = Action & {
  type: "REORDER_CORE_IDEAS";
  input: ReorderCoreIdeasInput;
};
export type AddTensionAction = Action & {
  type: "ADD_TENSION";
  input: AddTensionInput;
};
export type RemoveTensionAction = Action & {
  type: "REMOVE_TENSION";
  input: RemoveTensionInput;
};
export type AddOpenQuestionAction = Action & {
  type: "ADD_OPEN_QUESTION";
  input: AddOpenQuestionInput;
};
export type RemoveOpenQuestionAction = Action & {
  type: "REMOVE_OPEN_QUESTION";
  input: RemoveOpenQuestionInput;
};
export type AddChildMocAction = Action & {
  type: "ADD_CHILD_MOC";
  input: AddChildMocInput;
};
export type RemoveChildMocAction = Action & {
  type: "REMOVE_CHILD_MOC";
  input: RemoveChildMocInput;
};

export type MocMocManagementAction =
  | CreateMocAction
  | UpdateOrientationAction
  | UpdateDescriptionAction
  | AddCoreIdeaAction
  | UpdateCoreIdeaAction
  | RemoveCoreIdeaAction
  | ReorderCoreIdeasAction
  | AddTensionAction
  | RemoveTensionAction
  | AddOpenQuestionAction
  | RemoveOpenQuestionAction
  | AddChildMocAction
  | RemoveChildMocAction;
