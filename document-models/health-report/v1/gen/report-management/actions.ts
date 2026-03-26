import type { Action } from "document-model";
import type { GenerateReportInput, AddCheckInput } from "../types.js";

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
