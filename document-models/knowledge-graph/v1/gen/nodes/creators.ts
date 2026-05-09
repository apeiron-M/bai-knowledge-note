/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddNodeInputSchema,
  RemoveNodeInputSchema,
  UpdateNodeInputSchema,
} from "../schema/zod.js";
import type {
  AddNodeInput,
  RemoveNodeInput,
  UpdateNodeInput,
} from "../types.js";
import type {
  AddNodeAction,
  RemoveNodeAction,
  UpdateNodeAction,
} from "./actions.js";

export const addNode = (input: AddNodeInput) =>
  createAction<AddNodeAction>(
    "ADD_NODE",
    { ...input },
    undefined,
    AddNodeInputSchema,
    "global",
  );

export const removeNode = (input: RemoveNodeInput) =>
  createAction<RemoveNodeAction>(
    "REMOVE_NODE",
    { ...input },
    undefined,
    RemoveNodeInputSchema,
    "global",
  );

export const updateNode = (input: UpdateNodeInput) =>
  createAction<UpdateNodeAction>(
    "UPDATE_NODE",
    { ...input },
    undefined,
    UpdateNodeInputSchema,
    "global",
  );
