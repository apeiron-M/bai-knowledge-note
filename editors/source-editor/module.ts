/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { EditorModule } from "document-model";
import type { SourceAction, SourceDocument } from "document-models/source";
import { lazy } from "react";

/** Document editor module for the "bai/source" document type */
export const SourceEditor: EditorModule<SourceDocument, SourceAction> = {
  Component: lazy(() => import("./editor.js")),
  documentTypes: ["bai/source"],
  config: {
    id: "source-editor",
    name: "SourceEditor",
  },
};
