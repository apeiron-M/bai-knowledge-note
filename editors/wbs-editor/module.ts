/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { EditorModule } from "document-model";
import type {
  WorkBreakdownStructureAction,
  WorkBreakdownStructureDocument,
} from "document-models/work-breakdown-structure";
import { lazy } from "react";

/** Document editor module for the "bai/wbs" document type */
export const WbsEditor: EditorModule<
  WorkBreakdownStructureDocument,
  WorkBreakdownStructureAction
> = {
  Component: lazy(() => import("./editor.js")),
  documentTypes: ["bai/wbs"],
  config: {
    id: "wbs-editor",
    name: "WBS Editor",
  },
};
