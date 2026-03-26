import { PHDocumentController } from "document-model/core";
import { HealthReport } from "../module.js";
import type { HealthReportAction, HealthReportPHState } from "./types.js";

export const HealthReportController = PHDocumentController.forDocumentModel<
  HealthReportPHState,
  HealthReportAction
>(HealthReport);
