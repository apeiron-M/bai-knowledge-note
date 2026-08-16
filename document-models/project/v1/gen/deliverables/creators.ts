/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddDeliverableInputSchema,
  RemoveDeliverableInputSchema,
  SetDeliverableStatusInputSchema,
  UpdateDeliverableInputSchema,
} from "../schema/zod.js";
import type {
  AddDeliverableInput,
  RemoveDeliverableInput,
  SetDeliverableStatusInput,
  UpdateDeliverableInput,
} from "../types.js";
import type {
  AddDeliverableAction,
  RemoveDeliverableAction,
  SetDeliverableStatusAction,
  UpdateDeliverableAction,
} from "./actions.js";

export const addDeliverable = (input: AddDeliverableInput) =>
  createAction<AddDeliverableAction>(
    "ADD_DELIVERABLE",
    { ...input },
    undefined,
    AddDeliverableInputSchema,
    "global",
  );

export const updateDeliverable = (input: UpdateDeliverableInput) =>
  createAction<UpdateDeliverableAction>(
    "UPDATE_DELIVERABLE",
    { ...input },
    undefined,
    UpdateDeliverableInputSchema,
    "global",
  );

export const setDeliverableStatus = (input: SetDeliverableStatusInput) =>
  createAction<SetDeliverableStatusAction>(
    "SET_DELIVERABLE_STATUS",
    { ...input },
    undefined,
    SetDeliverableStatusInputSchema,
    "global",
  );

export const removeDeliverable = (input: RemoveDeliverableInput) =>
  createAction<RemoveDeliverableAction>(
    "REMOVE_DELIVERABLE",
    { ...input },
    undefined,
    RemoveDeliverableInputSchema,
    "global",
  );
