/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { EditorModule } from "document-model";
import { lazy } from "react";

/** Document editor module for the "bai/project" document type */
export const ProjectEditor: EditorModule = {
  Component: lazy(() => import("./editor.js")),
  documentTypes: ["bai/project"],
  config: {
    id: "project-editor",
    name: "Project Editor",
  },
};
