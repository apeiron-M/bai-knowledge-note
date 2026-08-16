/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  CreateProjectInputSchema,
  LinkWbsInputSchema,
  SetOwnerInputSchema,
  SetProjectStatusInputSchema,
  SetTargetDateInputSchema,
  UpdateProjectInfoInputSchema,
} from "../schema/zod.js";
import type {
  CreateProjectInput,
  LinkWbsInput,
  SetOwnerInput,
  SetProjectStatusInput,
  SetTargetDateInput,
  UpdateProjectInfoInput,
} from "../types.js";
import type {
  CreateProjectAction,
  LinkWbsAction,
  SetOwnerAction,
  SetProjectStatusAction,
  SetTargetDateAction,
  UpdateProjectInfoAction,
} from "./actions.js";

export const createProject = (input: CreateProjectInput) =>
  createAction<CreateProjectAction>(
    "CREATE_PROJECT",
    { ...input },
    undefined,
    CreateProjectInputSchema,
    "global",
  );

export const updateProjectInfo = (input: UpdateProjectInfoInput) =>
  createAction<UpdateProjectInfoAction>(
    "UPDATE_PROJECT_INFO",
    { ...input },
    undefined,
    UpdateProjectInfoInputSchema,
    "global",
  );

export const setProjectStatus = (input: SetProjectStatusInput) =>
  createAction<SetProjectStatusAction>(
    "SET_PROJECT_STATUS",
    { ...input },
    undefined,
    SetProjectStatusInputSchema,
    "global",
  );

export const setOwner = (input: SetOwnerInput) =>
  createAction<SetOwnerAction>(
    "SET_OWNER",
    { ...input },
    undefined,
    SetOwnerInputSchema,
    "global",
  );

export const setTargetDate = (input: SetTargetDateInput) =>
  createAction<SetTargetDateAction>(
    "SET_TARGET_DATE",
    { ...input },
    undefined,
    SetTargetDateInputSchema,
    "global",
  );

export const linkWbs = (input: LinkWbsInput) =>
  createAction<LinkWbsAction>(
    "LINK_WBS",
    { ...input },
    undefined,
    LinkWbsInputSchema,
    "global",
  );
