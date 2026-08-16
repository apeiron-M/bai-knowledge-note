/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddNoteInput,
  RemoveNoteInput,
  SetOwnerInput,
  SetProjectRefInput,
  SetReferencesInput,
} from "../types.js";

export type AddNoteAction = Action & { type: "ADD_NOTE"; input: AddNoteInput };
export type RemoveNoteAction = Action & {
  type: "REMOVE_NOTE";
  input: RemoveNoteInput;
};
export type SetOwnerAction = Action & {
  type: "SET_OWNER";
  input: SetOwnerInput;
};
export type SetReferencesAction = Action & {
  type: "SET_REFERENCES";
  input: SetReferencesInput;
};
export type SetProjectRefAction = Action & {
  type: "SET_PROJECT_REF";
  input: SetProjectRefInput;
};

export type WorkBreakdownStructureDocumentationAction =
  | AddNoteAction
  | RemoveNoteAction
  | SetOwnerAction
  | SetReferencesAction
  | SetProjectRefAction;
