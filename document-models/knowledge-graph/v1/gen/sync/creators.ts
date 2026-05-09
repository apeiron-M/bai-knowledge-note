/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import { SyncGraphInputSchema } from "../schema/zod.js";
import type { SyncGraphInput } from "../types.js";
import type { SyncGraphAction } from "./actions.js";

export const syncGraph = (input: SyncGraphInput) =>
  createAction<SyncGraphAction>(
    "SYNC_GRAPH",
    { ...input },
    undefined,
    SyncGraphInputSchema,
    "global",
  );
