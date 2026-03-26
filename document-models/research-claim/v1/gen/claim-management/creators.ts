import { createAction } from "document-model/core";
import {
  CreateClaimInputSchema,
  AddResearchConnectionInputSchema,
  RemoveResearchConnectionInputSchema,
  UpdateClaimContentInputSchema,
} from "../schema/zod.js";
import type {
  CreateClaimInput,
  AddResearchConnectionInput,
  RemoveResearchConnectionInput,
  UpdateClaimContentInput,
} from "../types.js";
import type {
  CreateClaimAction,
  AddResearchConnectionAction,
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
