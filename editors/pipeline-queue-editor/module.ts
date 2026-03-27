import type { EditorModule } from "document-model";
import { lazy } from "react";

/** Document editor module for the "["bai/pipeline-queue"]" document type */
export const PipelineQueueEditor: EditorModule = {
  Component: lazy(() => import("./editor.js")),
  documentTypes: ["bai/pipeline-queue"],
  config: {
    id: "pipeline-queue-editor",
    name: "PipelineQueueEditor",
  },
};
