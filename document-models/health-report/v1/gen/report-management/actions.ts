/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type { AddCheckInput, GenerateReportInput } from "../types.js";

export type GenerateReportAction = Action & {
  type: "GENERATE_REPORT";
  input: GenerateReportInput;
};
export type AddCheckAction = Action & {
  type: "ADD_CHECK";
  input: AddCheckInput;
};

export type HealthReportReportManagementAction =
  | GenerateReportAction
  | AddCheckAction;
