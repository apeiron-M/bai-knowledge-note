import type { EditorModule } from "document-model";
import { lazy } from "react";

/** Document editor module for the "["bai/research-claim"]" document type */
export const ResearchClaimEditor: EditorModule = {
  Component: lazy(() => import("./editor.js")),
  documentTypes: ["bai/research-claim"],
  config: {
    id: "research-claim-editor",
    name: "ResearchClaimEditor",
  },
};
