import { createAction } from "document-model";
import {
  CreateObservationInputSchema,
  PromoteObservationInputSchema,
  ImplementObservationInputSchema,
  ArchiveObservationInputSchema,
} from "../schema/zod.js";
import type {
  CreateObservationInput,
  PromoteObservationInput,
  ImplementObservationInput,
  ArchiveObservationInput,
} from "../types.js";
import type {
  CreateObservationAction,
  PromoteObservationAction,
  ImplementObservationAction,
  ArchiveObservationAction,
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
