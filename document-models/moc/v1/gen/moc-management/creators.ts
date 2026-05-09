/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddChildMocInputSchema,
  AddCoreIdeaInputSchema,
  AddOpenQuestionInputSchema,
  AddTensionInputSchema,
  CreateMocInputSchema,
  RemoveChildMocInputSchema,
  RemoveCoreIdeaInputSchema,
  RemoveOpenQuestionInputSchema,
  RemoveTensionInputSchema,
  ReorderCoreIdeasInputSchema,
  UpdateCoreIdeaInputSchema,
  UpdateDescriptionInputSchema,
  UpdateOrientationInputSchema,
} from "../schema/zod.js";
import type {
  AddChildMocInput,
  AddCoreIdeaInput,
  AddOpenQuestionInput,
  AddTensionInput,
  CreateMocInput,
  RemoveChildMocInput,
  RemoveCoreIdeaInput,
  RemoveOpenQuestionInput,
  RemoveTensionInput,
  ReorderCoreIdeasInput,
  UpdateCoreIdeaInput,
  UpdateDescriptionInput,
  UpdateOrientationInput,
} from "../types.js";
import type {
  AddChildMocAction,
  AddCoreIdeaAction,
  AddOpenQuestionAction,
  AddTensionAction,
  CreateMocAction,
  RemoveChildMocAction,
  RemoveCoreIdeaAction,
  RemoveOpenQuestionAction,
  RemoveTensionAction,
  ReorderCoreIdeasAction,
  UpdateCoreIdeaAction,
  UpdateDescriptionAction,
  UpdateOrientationAction,
} from "./actions.js";

export const createMoc = (input: CreateMocInput) =>
  createAction<CreateMocAction>(
    "CREATE_MOC",
    { ...input },
    undefined,
    CreateMocInputSchema,
    "global",
  );

export const updateOrientation = (input: UpdateOrientationInput) =>
  createAction<UpdateOrientationAction>(
    "UPDATE_ORIENTATION",
    { ...input },
    undefined,
    UpdateOrientationInputSchema,
    "global",
  );

export const updateDescription = (input: UpdateDescriptionInput) =>
  createAction<UpdateDescriptionAction>(
    "UPDATE_DESCRIPTION",
    { ...input },
    undefined,
    UpdateDescriptionInputSchema,
    "global",
  );

export const addCoreIdea = (input: AddCoreIdeaInput) =>
  createAction<AddCoreIdeaAction>(
    "ADD_CORE_IDEA",
    { ...input },
    undefined,
    AddCoreIdeaInputSchema,
    "global",
  );

export const updateCoreIdea = (input: UpdateCoreIdeaInput) =>
  createAction<UpdateCoreIdeaAction>(
    "UPDATE_CORE_IDEA",
    { ...input },
    undefined,
    UpdateCoreIdeaInputSchema,
    "global",
  );

export const removeCoreIdea = (input: RemoveCoreIdeaInput) =>
  createAction<RemoveCoreIdeaAction>(
    "REMOVE_CORE_IDEA",
    { ...input },
    undefined,
    RemoveCoreIdeaInputSchema,
    "global",
  );

export const reorderCoreIdeas = (input: ReorderCoreIdeasInput) =>
  createAction<ReorderCoreIdeasAction>(
    "REORDER_CORE_IDEAS",
    { ...input },
    undefined,
    ReorderCoreIdeasInputSchema,
    "global",
  );

export const addTension = (input: AddTensionInput) =>
  createAction<AddTensionAction>(
    "ADD_TENSION",
    { ...input },
    undefined,
    AddTensionInputSchema,
    "global",
  );

export const removeTension = (input: RemoveTensionInput) =>
  createAction<RemoveTensionAction>(
    "REMOVE_TENSION",
    { ...input },
    undefined,
    RemoveTensionInputSchema,
    "global",
  );

export const addOpenQuestion = (input: AddOpenQuestionInput) =>
  createAction<AddOpenQuestionAction>(
    "ADD_OPEN_QUESTION",
    { ...input },
    undefined,
    AddOpenQuestionInputSchema,
    "global",
  );

export const removeOpenQuestion = (input: RemoveOpenQuestionInput) =>
  createAction<RemoveOpenQuestionAction>(
    "REMOVE_OPEN_QUESTION",
    { ...input },
    undefined,
    RemoveOpenQuestionInputSchema,
    "global",
  );

export const addChildMoc = (input: AddChildMocInput) =>
  createAction<AddChildMocAction>(
    "ADD_CHILD_MOC",
    { ...input },
    undefined,
    AddChildMocInputSchema,
    "global",
  );

export const removeChildMoc = (input: RemoveChildMocInput) =>
  createAction<RemoveChildMocAction>(
    "REMOVE_CHILD_MOC",
    { ...input },
    undefined,
    RemoveChildMocInputSchema,
    "global",
  );
