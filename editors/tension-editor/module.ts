/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { EditorModule } from "document-model";
import type { TensionAction, TensionDocument } from "document-models/tension";
import { lazy } from "react";

/** Document editor module for the "bai/tension" document type */
export const TensionEditor: EditorModule<TensionDocument, TensionAction> = {
  Component: lazy(() => import("./editor.js")),
  documentTypes: ["bai/tension"],
  config: {
    id: "tension-editor",
    name: "TensionEditor",
  },
};
