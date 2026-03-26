import { type SignalDispatch } from "document-model";
import type { GenerateReportAction, AddCheckAction } from "./actions.js";
import type { HealthReportState } from "../types.js";

export interface HealthReportReportManagementOperations {
  generateReportOperation: (
    state: HealthReportState,
    action: GenerateReportAction,
    dispatch?: SignalDispatch,
  ) => void;
  addCheckOperation: (
    state: HealthReportState,
    action: AddCheckAction,
    dispatch?: SignalDispatch,
  ) => void;
}
