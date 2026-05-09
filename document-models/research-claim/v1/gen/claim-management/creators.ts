/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddResearchConnectionInputSchema,
  CreateClaimInputSchema,
  RemoveResearchConnectionInputSchema,
  UpdateClaimContentInputSchema,
} from "../schema/zod.js";
import type {
  AddResearchConnectionInput,
  CreateClaimInput,
  RemoveResearchConnectionInput,
  UpdateClaimContentInput,
} from "../types.js";
import type {
  AddResearchConnectionAction,
  CreateClaimAction,
  RemoveResearchConnectionAction,
  UpdateClaimContentAction,
} from "./actions.js";

export const createClaim = (input: CreateClaimInput) =>
  createAction<CreateClaimAction>(
    "CREATE_CLAIM",
    { ...input },
    undefined,
    CreateClaimInputSchema,
    "global",
  );

export const addResearchConnection = (input: AddResearchConnectionInput) =>
  createAction<AddResearchConnectionAction>(
    "ADD_RESEARCH_CONNECTION",
    { ...input },
    undefined,
    AddResearchConnectionInputSchema,
    "global",
  );

export const removeResearchConnection = (
  input: RemoveResearchConnectionInput,
) =>
  createAction<RemoveResearchConnectionAction>(
    "REMOVE_RESEARCH_CONNECTION",
    { ...input },
    undefined,
    RemoveResearchConnectionInputSchema,
    "global",
  );

export const updateClaimContent = (input: UpdateClaimContentInput) =>
  createAction<UpdateClaimContentAction>(
    "UPDATE_CLAIM_CONTENT",
    { ...input },
    undefined,
    UpdateClaimContentInputSchema,
    "global",
  );
