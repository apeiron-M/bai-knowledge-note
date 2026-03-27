import type { EditorModule } from "document-model";
import { lazy } from "react";

/** Document editor module for the "["bai/vault-config"]" document type */
export const VaultConfigEditor: EditorModule = {
  Component: lazy(() => import("./editor.js")),
  documentTypes: ["bai/vault-config"],
  config: {
    id: "vault-config-editor",
    name: "VaultConfigEditor",
  },
};
