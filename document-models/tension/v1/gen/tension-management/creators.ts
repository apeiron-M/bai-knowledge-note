import { createAction } from "document-model";
import {
  CreateTensionInputSchema,
  ResolveTensionInputSchema,
  DissolveTensionInputSchema,
  AddInvolvedRefInputSchema,
} from "../schema/zod.js";
import type {
  CreateTensionInput,
  ResolveTensionInput,
  DissolveTensionInput,
  AddInvolvedRefInput,
} from "../types.js";
import type {
  CreateTensionAction,
  ResolveTensionAction,
  DissolveTensionAction,
  AddInvolvedRefAction,
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
