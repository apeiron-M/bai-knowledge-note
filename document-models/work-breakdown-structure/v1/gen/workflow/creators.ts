/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddDependenciesInputSchema,
  AssignGoalInputSchema,
  RemoveDependenciesInputSchema,
  SetGoalStatusInputSchema,
  SetOutcomeInputSchema,
} from "../schema/zod.js";
import type {
  AddDependenciesInput,
  AssignGoalInput,
  RemoveDependenciesInput,
  SetGoalStatusInput,
  SetOutcomeInput,
} from "../types.js";
import type {
  AddDependenciesAction,
  AssignGoalAction,
  RemoveDependenciesAction,
  SetGoalStatusAction,
  SetOutcomeAction,
} from "./actions.js";

export const setGoalStatus = (input: SetGoalStatusInput) =>
  createAction<SetGoalStatusAction>(
    "SET_GOAL_STATUS",
    { ...input },
    undefined,
    SetGoalStatusInputSchema,
    "global",
  );

export const assignGoal = (input: AssignGoalInput) =>
  createAction<AssignGoalAction>(
    "ASSIGN_GOAL",
    { ...input },
    undefined,
    AssignGoalInputSchema,
    "global",
  );

export const setOutcome = (input: SetOutcomeInput) =>
  createAction<SetOutcomeAction>(
    "SET_OUTCOME",
    { ...input },
    undefined,
    SetOutcomeInputSchema,
    "global",
  );

export const addDependencies = (input: AddDependenciesInput) =>
  createAction<AddDependenciesAction>(
    "ADD_DEPENDENCIES",
    { ...input },
    undefined,
    AddDependenciesInputSchema,
    "global",
  );

export const removeDependencies = (input: RemoveDependenciesInput) =>
  createAction<RemoveDependenciesAction>(
    "REMOVE_DEPENDENCIES",
    { ...input },
    undefined,
    RemoveDependenciesInputSchema,
    "global",
  );
