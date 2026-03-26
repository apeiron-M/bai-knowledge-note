import { createAction } from "document-model/core";
import {
  SetTitleInputSchema,
  SetDescriptionInputSchema,
  SetNoteTypeInputSchema,
  SetContentInputSchema,
  PatchContentInputSchema,
  SetMetadataFieldInputSchema,
  SetMetadataListFieldInputSchema,
} from "../schema/zod.js";
import type {
  SetTitleInput,
  SetDescriptionInput,
  SetNoteTypeInput,
  SetContentInput,
  PatchContentInput,
  SetMetadataFieldInput,
  SetMetadataListFieldInput,
} from "../types.js";
import type {
  SetTitleAction,
  SetDescriptionAction,
  SetNoteTypeAction,
  SetContentAction,
  PatchContentAction,
  SetMetadataFieldAction,
  SetMetadataListFieldAction,
} from "./actions.js";

export const setTitle = (input: SetTitleInput) =>
  createAction<SetTitleAction>(
    "SET_TITLE",
    { ...input },
    undefined,
    SetTitleInputSchema,
    "global",
  );

export const setDescription = (input: SetDescriptionInput) =>
  createAction<SetDescriptionAction>(
    "SET_DESCRIPTION",
    { ...input },
    undefined,
    SetDescriptionInputSchema,
    "global",
  );

export const setNoteType = (input: SetNoteTypeInput) =>
  createAction<SetNoteTypeAction>(
    "SET_NOTE_TYPE",
    { ...input },
    undefined,
    SetNoteTypeInputSchema,
    "global",
  );

export const setContent = (input: SetContentInput) =>
  createAction<SetContentAction>(
    "SET_CONTENT",
    { ...input },
    undefined,
    SetContentInputSchema,
    "global",
  );

export const patchContent = (input: PatchContentInput) =>
  createAction<PatchContentAction>(
    "PATCH_CONTENT",
    { ...input },
    undefined,
    PatchContentInputSchema,
    "global",
  );

export const setMetadataField = (input: SetMetadataFieldInput) =>
  createAction<SetMetadataFieldAction>(
    "SET_METADATA_FIELD",
    { ...input },
    undefined,
    SetMetadataFieldInputSchema,
    "global",
  );

export const setMetadataListField = (input: SetMetadataListFieldInput) =>
  createAction<SetMetadataListFieldAction>(
    "SET_METADATA_LIST_FIELD",
    { ...input },
    undefined,
    SetMetadataListFieldInputSchema,
    "global",
  );
