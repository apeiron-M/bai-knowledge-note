/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddKnowledgeRefInputSchema,
  RemoveKnowledgeRefInputSchema,
  SetReferencesInputSchema,
} from "../schema/zod.js";
import type {
  AddKnowledgeRefInput,
  RemoveKnowledgeRefInput,
  SetReferencesInput,
} from "../types.js";
import type {
  AddKnowledgeRefAction,
  RemoveKnowledgeRefAction,
  SetReferencesAction,
} from "./actions.js";

export const addKnowledgeRef = (input: AddKnowledgeRefInput) =>
  createAction<AddKnowledgeRefAction>(
    "ADD_KNOWLEDGE_REF",
    { ...input },
    undefined,
    AddKnowledgeRefInputSchema,
    "global",
  );

export const removeKnowledgeRef = (input: RemoveKnowledgeRefInput) =>
  createAction<RemoveKnowledgeRefAction>(
    "REMOVE_KNOWLEDGE_REF",
    { ...input },
    undefined,
    RemoveKnowledgeRefInputSchema,
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
