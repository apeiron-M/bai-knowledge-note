import { createAction } from "document-model";
import { SetLastViewedInputSchema } from "../schema/zod.js";
import type { SetLastViewedInput } from "../types.js";
import type { SetLastViewedAction } from "./actions.js";

export const setLastViewed = (input: SetLastViewedInput) =>
  createAction<SetLastViewedAction>(
    "SET_LAST_VIEWED",
    { ...input },
    undefined,
    SetLastViewedInputSchema,
    "local",
  );
