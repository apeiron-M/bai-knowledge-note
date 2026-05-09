/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddCheckInputSchema,
  GenerateReportInputSchema,
} from "../schema/zod.js";
import type { AddCheckInput, GenerateReportInput } from "../types.js";
import type { AddCheckAction, GenerateReportAction } from "./actions.js";

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
