/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  CreateGoalInputSchema,
  DeleteGoalInputSchema,
  ReorderInputSchema,
  UpdateGoalDescriptionInputSchema,
} from "../schema/zod.js";
import type {
  CreateGoalInput,
  DeleteGoalInput,
  ReorderInput,
  UpdateGoalDescriptionInput,
} from "../types.js";
import type {
  CreateGoalAction,
  DeleteGoalAction,
  ReorderAction,
  UpdateGoalDescriptionAction,
} from "./actions.js";

export const createGoal = (input: CreateGoalInput) =>
  createAction<CreateGoalAction>(
    "CREATE_GOAL",
    { ...input },
    undefined,
    CreateGoalInputSchema,
    "global",
  );

export const updateGoalDescription = (input: UpdateGoalDescriptionInput) =>
  createAction<UpdateGoalDescriptionAction>(
    "UPDATE_GOAL_DESCRIPTION",
    { ...input },
    undefined,
    UpdateGoalDescriptionInputSchema,
    "global",
  );

export const deleteGoal = (input: DeleteGoalInput) =>
  createAction<DeleteGoalAction>(
    "DELETE_GOAL",
    { ...input },
    undefined,
    DeleteGoalInputSchema,
    "global",
  );

export const reorder = (input: ReorderInput) =>
  createAction<ReorderAction>(
    "REORDER",
    { ...input },
    undefined,
    ReorderInputSchema,
    "global",
  );
