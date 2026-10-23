/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { EditorModule } from "document-model";
import type {
  VaultConfigAction,
  VaultConfigDocument,
} from "document-models/vault-config";
import { lazy } from "react";

/** Document editor module for the "bai/vault-config" document type */
export const VaultConfigEditor: EditorModule<
  VaultConfigDocument,
  VaultConfigAction
> = {
  Component: lazy(() => import("./editor.js")),
  documentTypes: ["bai/vault-config"],
  config: {
    id: "vault-config-editor",
    name: "VaultConfigEditor",
  },
};
