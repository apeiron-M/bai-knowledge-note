import type { EditorModule } from "document-model";
import { lazy } from "react";

/** Document editor module for the "["bai/observation"]" document type */
export const ObservationEditor: EditorModule = {
  Component: lazy(() => import("./editor.js")),
  documentTypes: ["bai/observation"],
  config: {
    id: "observation-editor",
    name: "ObservationEditor",
  },
};
