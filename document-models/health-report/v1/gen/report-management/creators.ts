import { createAction } from "document-model";
import {
  GenerateReportInputSchema,
  AddCheckInputSchema,
} from "../schema/zod.js";
import type { GenerateReportInput, AddCheckInput } from "../types.js";
import type { GenerateReportAction, AddCheckAction } from "./actions.js";

export const generateReport = (input: GenerateReportInput) =>
  createAction<GenerateReportAction>(
    "GENERATE_REPORT",
    { ...input },
    undefined,
    GenerateReportInputSchema,
    "global",
  );

export const addCheck = (input: AddCheckInput) =>
  createAction<AddCheckAction>(
    "ADD_CHECK",
    { ...input },
    undefined,
    AddCheckInputSchema,
    "global",
  );
