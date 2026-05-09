/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddReseedEntryInputSchema,
  AddSignalInputSchema,
  InitializeDerivationInputSchema,
  UpdateDimensionRationaleInputSchema,
} from "../schema/zod.js";
import type {
  AddReseedEntryInput,
  AddSignalInput,
  InitializeDerivationInput,
  UpdateDimensionRationaleInput,
} from "../types.js";
import type {
  AddReseedEntryAction,
  AddSignalAction,
  InitializeDerivationAction,
  UpdateDimensionRationaleAction,
} from "./actions.js";

export const initializeDerivation = (input: InitializeDerivationInput) =>
  createAction<InitializeDerivationAction>(
    "INITIALIZE_DERIVATION",
    { ...input },
    undefined,
    InitializeDerivationInputSchema,
    "global",
  );

export const addSignal = (input: AddSignalInput) =>
  createAction<AddSignalAction>(
    "ADD_SIGNAL",
    { ...input },
    undefined,
    AddSignalInputSchema,
    "global",
  );

export const addReseedEntry = (input: AddReseedEntryInput) =>
  createAction<AddReseedEntryAction>(
    "ADD_RESEED_ENTRY",
    { ...input },
    undefined,
    AddReseedEntryInputSchema,
    "global",
  );

export const updateDimensionRationale = (
  input: UpdateDimensionRationaleInput,
) =>
  createAction<UpdateDimensionRationaleAction>(
    "UPDATE_DIMENSION_RATIONALE",
    { ...input },
    undefined,
    UpdateDimensionRationaleInputSchema,
    "global",
  );
