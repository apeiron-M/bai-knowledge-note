/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { EditorModule } from "document-model";
import type {
  ObservationAction,
  ObservationDocument,
} from "document-models/observation";
import { lazy } from "react";

/** Document editor module for the "bai/observation" document type */
export const ObservationEditor: EditorModule<
  ObservationDocument,
  ObservationAction
> = {
  Component: lazy(() => import("./editor.js")),
  documentTypes: ["bai/observation"],
  config: {
    id: "observation-editor",
    name: "ObservationEditor",
  },
};
