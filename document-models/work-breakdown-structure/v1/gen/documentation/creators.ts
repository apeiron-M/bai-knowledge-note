/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddNoteInputSchema,
  RemoveNoteInputSchema,
  SetOwnerInputSchema,
  SetProjectRefInputSchema,
  SetReferencesInputSchema,
} from "../schema/zod.js";
import type {
  AddNoteInput,
  RemoveNoteInput,
  SetOwnerInput,
  SetProjectRefInput,
  SetReferencesInput,
} from "../types.js";
import type {
  AddNoteAction,
  RemoveNoteAction,
  SetOwnerAction,
  SetProjectRefAction,
  SetReferencesAction,
} from "./actions.js";

export const addNote = (input: AddNoteInput) =>
  createAction<AddNoteAction>(
    "ADD_NOTE",
    { ...input },
    undefined,
    AddNoteInputSchema,
    "global",
  );

export const removeNote = (input: RemoveNoteInput) =>
  createAction<RemoveNoteAction>(
    "REMOVE_NOTE",
    { ...input },
    undefined,
    RemoveNoteInputSchema,
    "global",
  );

export const setOwner = (input: SetOwnerInput) =>
  createAction<SetOwnerAction>(
    "SET_OWNER",
    { ...input },
    undefined,
    SetOwnerInputSchema,
    "global",
  );

export const setReferences = (input: SetReferencesInput) =>
  createAction<SetReferencesAction>(
    "SET_REFERENCES",
    { ...input },
    undefined,
    SetReferencesInputSchema,
    "global",
  );

export const setProjectRef = (input: SetProjectRefInput) =>
  createAction<SetProjectRefAction>(
    "SET_PROJECT_REF",
    { ...input },
    undefined,
    SetProjectRefInputSchema,
    "global",
  );
