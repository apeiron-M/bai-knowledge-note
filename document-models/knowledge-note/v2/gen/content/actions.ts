/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  PatchContentInput,
  SetContentInput,
  SetDescriptionInput,
  SetMetadataFieldInput,
  SetMetadataListFieldInput,
  SetNoteTypeInput,
  SetTitleInput,
} from "../types.js";

export type SetTitleAction = Action & {
  type: "SET_TITLE";
  input: SetTitleInput;
};
export type SetDescriptionAction = Action & {
  type: "SET_DESCRIPTION";
  input: SetDescriptionInput;
};
export type SetNoteTypeAction = Action & {
  type: "SET_NOTE_TYPE";
  input: SetNoteTypeInput;
};
export type SetContentAction = Action & {
  type: "SET_CONTENT";
  input: SetContentInput;
};
export type PatchContentAction = Action & {
  type: "PATCH_CONTENT";
  input: PatchContentInput;
};
export type SetMetadataFieldAction = Action & {
  type: "SET_METADATA_FIELD";
  input: SetMetadataFieldInput;
};
export type SetMetadataListFieldAction = Action & {
  type: "SET_METADATA_LIST_FIELD";
  input: SetMetadataListFieldInput;
};

export type KnowledgeNoteContentAction =
  | SetTitleAction
  | SetDescriptionAction
  | SetNoteTypeAction
  | SetContentAction
  | PatchContentAction
  | SetMetadataFieldAction
  | SetMetadataListFieldAction;
