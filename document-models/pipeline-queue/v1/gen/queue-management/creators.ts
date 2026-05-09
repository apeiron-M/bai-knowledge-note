/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddTaskInputSchema,
  AdvancePhaseInputSchema,
  AssignTaskInputSchema,
  BlockTaskInputSchema,
  CompleteTaskInputSchema,
  FailTaskInputSchema,
  UnblockTaskInputSchema,
} from "../schema/zod.js";
import type {
  AddTaskInput,
  AdvancePhaseInput,
  AssignTaskInput,
  BlockTaskInput,
  CompleteTaskInput,
  FailTaskInput,
  UnblockTaskInput,
} from "../types.js";
import type {
  AddTaskAction,
  AdvancePhaseAction,
  AssignTaskAction,
  BlockTaskAction,
  CompleteTaskAction,
  FailTaskAction,
  UnblockTaskAction,
} from "./actions.js";

export const addTask = (input: AddTaskInput) =>
  createAction<AddTaskAction>(
    "ADD_TASK",
    { ...input },
    undefined,
    AddTaskInputSchema,
    "global",
  );

export const assignTask = (input: AssignTaskInput) =>
  createAction<AssignTaskAction>(
    "ASSIGN_TASK",
    { ...input },
    undefined,
    AssignTaskInputSchema,
    "global",
  );

export const advancePhase = (input: AdvancePhaseInput) =>
  createAction<AdvancePhaseAction>(
    "ADVANCE_PHASE",
    { ...input },
    undefined,
    AdvancePhaseInputSchema,
    "global",
  );

export const completeTask = (input: CompleteTaskInput) =>
  createAction<CompleteTaskAction>(
    "COMPLETE_TASK",
    { ...input },
    undefined,
    CompleteTaskInputSchema,
    "global",
  );

export const failTask = (input: FailTaskInput) =>
  createAction<FailTaskAction>(
    "FAIL_TASK",
    { ...input },
    undefined,
    FailTaskInputSchema,
    "global",
  );

export const blockTask = (input: BlockTaskInput) =>
  createAction<BlockTaskAction>(
    "BLOCK_TASK",
    { ...input },
    undefined,
    BlockTaskInputSchema,
    "global",
  );

export const unblockTask = (input: UnblockTaskInput) =>
  createAction<UnblockTaskAction>(
    "UNBLOCK_TASK",
    { ...input },
    undefined,
    UnblockTaskInputSchema,
    "global",
  );
