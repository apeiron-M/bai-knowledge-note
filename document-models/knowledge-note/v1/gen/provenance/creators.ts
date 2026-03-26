import { createAction } from "document-model/core";
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
