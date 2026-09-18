/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import { SetProvenanceInputSchema } from "../schema/zod.js";
import type { SetProvenanceInput } from "../types.js";
import type { SetProvenanceAction } from "./actions.js";

export const setProvenance = (input: SetProvenanceInput) =>
  createAction<SetProvenanceAction>(
    "SET_PROVENANCE",
    { ...input },
    undefined,
    SetProvenanceInputSchema,
    "global",
  );
