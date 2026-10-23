/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { EditorModule } from "document-model";
import type {
  ResearchClaimAction,
  ResearchClaimDocument,
} from "document-models/research-claim";
import { lazy } from "react";

/** Document editor module for the "bai/research-claim" document type */
export const ResearchClaimEditor: EditorModule<
  ResearchClaimDocument,
  ResearchClaimAction
> = {
  Component: lazy(() => import("./editor.js")),
  documentTypes: ["bai/research-claim"],
  config: {
    id: "research-claim-editor",
    name: "ResearchClaimEditor",
  },
};
