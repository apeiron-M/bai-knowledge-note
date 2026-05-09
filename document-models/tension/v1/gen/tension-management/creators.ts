/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddInvolvedRefInputSchema,
  CreateTensionInputSchema,
  DissolveTensionInputSchema,
  ResolveTensionInputSchema,
} from "../schema/zod.js";
import type {
  AddInvolvedRefInput,
  CreateTensionInput,
  DissolveTensionInput,
  ResolveTensionInput,
} from "../types.js";
import type {
  AddInvolvedRefAction,
  CreateTensionAction,
  DissolveTensionAction,
  ResolveTensionAction,
} from "./actions.js";

export const createTension = (input: CreateTensionInput) =>
  createAction<CreateTensionAction>(
    "CREATE_TENSION",
    { ...input },
    undefined,
    CreateTensionInputSchema,
    "global",
  );

export const resolveTension = (input: ResolveTensionInput) =>
  createAction<ResolveTensionAction>(
    "RESOLVE_TENSION",
    { ...input },
    undefined,
    ResolveTensionInputSchema,
    "global",
  );

export const dissolveTension = (input: DissolveTensionInput) =>
  createAction<DissolveTensionAction>(
    "DISSOLVE_TENSION",
    { ...input },
    undefined,
    DissolveTensionInputSchema,
    "global",
  );

export const addInvolvedRef = (input: AddInvolvedRefInput) =>
  createAction<AddInvolvedRefAction>(
    "ADD_INVOLVED_REF",
    { ...input },
    undefined,
    AddInvolvedRefInputSchema,
    "global",
  );
