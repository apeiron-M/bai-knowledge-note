import type { EditorModule } from "document-model";
import { lazy } from "react";

/** Document editor module for the "["bai/health-report"]" document type */
export const HealthReportEditor: EditorModule = {
  Component: lazy(() => import("./editor.js")),
  documentTypes: ["bai/health-report"],
  config: {
    id: "health-report-editor",
    name: "HealthReportEditor",
  },
};
