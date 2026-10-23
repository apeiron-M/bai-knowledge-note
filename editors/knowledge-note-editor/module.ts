/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { EditorModule } from "document-model";
import type {
  KnowledgeNoteAction,
  KnowledgeNoteDocument,
} from "document-models/knowledge-note";
import { lazy } from "react";

/** Document editor module for the "bai/knowledge-note" document type */
export const KnowledgeNoteEditor: EditorModule<
  KnowledgeNoteDocument,
  KnowledgeNoteAction
> = {
  Component: lazy(() => import("./editor.js")),
  documentTypes: ["bai/knowledge-note"],
  config: {
    id: "knowledge-note-editor",
    name: "KnowledgeNoteEditor",
  },
};
