/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { HealthReportGlobalState } from "../types.js";
import type { AddCheckAction, GenerateReportAction } from "./actions.js";

export interface HealthReportReportManagementOperations {
  generateReportOperation: (
    state: HealthReportGlobalState,
    action: GenerateReportAction,
    dispatch?: SignalDispatch,
  ) => void;
  addCheckOperation: (
    state: HealthReportGlobalState,
    action: AddCheckAction,
    dispatch?: SignalDispatch,
  ) => void;
}
