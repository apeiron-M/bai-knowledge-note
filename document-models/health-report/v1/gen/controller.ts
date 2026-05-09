/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { PHDocumentController } from "document-model";
import { HealthReport } from "../module.js";
import type { HealthReportAction, HealthReportPHState } from "./types.js";

export const HealthReportController = PHDocumentController.forDocumentModel<
  HealthReportPHState,
  HealthReportAction
>(HealthReport);
