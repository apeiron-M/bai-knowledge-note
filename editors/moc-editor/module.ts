import type { EditorModule } from "document-model";
import { lazy } from "react";

/** Document editor module for the "["bai/moc"]" document type */
export const MocEditor: EditorModule = {
  Component: lazy(() => import("./editor.js")),
  documentTypes: ["bai/moc"],
  config: {
    id: "moc-editor",
    name: "MocEditor",
  },
};
