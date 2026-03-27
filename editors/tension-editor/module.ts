import type { EditorModule } from "document-model";
import { lazy } from "react";

/** Document editor module for the "["bai/tension"]" document type */
export const TensionEditor: EditorModule = {
  Component: lazy(() => import("./editor.js")),
  documentTypes: ["bai/tension"],
  config: {
    id: "tension-editor",
    name: "TensionEditor",
  },
};
