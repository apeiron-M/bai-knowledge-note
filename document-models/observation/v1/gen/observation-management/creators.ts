/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  ArchiveObservationInputSchema,
  CreateObservationInputSchema,
  ImplementObservationInputSchema,
  PromoteObservationInputSchema,
} from "../schema/zod.js";
import type {
  ArchiveObservationInput,
  CreateObservationInput,
  ImplementObservationInput,
  PromoteObservationInput,
} from "../types.js";
import type {
  ArchiveObservationAction,
  CreateObservationAction,
  ImplementObservationAction,
  PromoteObservationAction,
} from "./actions.js";

export const createObservation = (input: CreateObservationInput) =>
  createAction<CreateObservationAction>(
    "CREATE_OBSERVATION",
    { ...input },
    undefined,
    CreateObservationInputSchema,
    "global",
  );

export const promoteObservation = (input: PromoteObservationInput) =>
  createAction<PromoteObservationAction>(
    "PROMOTE_OBSERVATION",
    { ...input },
    undefined,
    PromoteObservationInputSchema,
    "global",
  );

export const implementObservation = (input: ImplementObservationInput) =>
  createAction<ImplementObservationAction>(
    "IMPLEMENT_OBSERVATION",
    { ...input },
    undefined,
    ImplementObservationInputSchema,
    "global",
  );

export const archiveObservation = (input: ArchiveObservationInput) =>
  createAction<ArchiveObservationAction>(
    "ARCHIVE_OBSERVATION",
    { ...input },
    undefined,
    ArchiveObservationInputSchema,
    "global",
  );
