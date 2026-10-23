/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { EditorModule } from "document-model";
import type {
  ScopeOfWorkAction,
  ScopeOfWorkDocument,
} from "document-models/scope-of-work";
import { lazy } from "react";

/** Document editor module for the "powerhouse/scopeofwork" document type */
export const ScopeOfWork: EditorModule<ScopeOfWorkDocument, ScopeOfWorkAction> =
  {
    Component: lazy(() => import("./editor.js")),
    documentTypes: ["powerhouse/scopeofwork"],
    config: {
      id: "scope-of-work",
      name: "Scope of Work",
    },
  };
