/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { EditorModule } from "document-model";
import type {
  HealthReportAction,
  HealthReportDocument,
} from "document-models/health-report";
import { lazy } from "react";

/** Document editor module for the "bai/health-report" document type */
export const HealthReportEditor: EditorModule<
  HealthReportDocument,
  HealthReportAction
> = {
  Component: lazy(() => import("./editor.js")),
  documentTypes: ["bai/health-report"],
  config: {
    id: "health-report-editor",
    name: "HealthReportEditor",
  },
};
