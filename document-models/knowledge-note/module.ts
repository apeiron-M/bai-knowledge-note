import type { DocumentModelModule } from "document-model";
import { createState } from "document-model";
import { defaultBaseState } from "document-model/core";
import type { KnowledgeNotePHState } from "knowledge-note/document-models/knowledge-note";
import {
  actions,
  documentModel,
  reducer,
  utils,
} from "knowledge-note/document-models/knowledge-note";

/** Document model module for the KnowledgeNote document type */
export const KnowledgeNote: DocumentModelModule<KnowledgeNotePHState> = {
  version: 1,
  reducer,
  actions,
  utils,
  documentModel: createState(defaultBaseState(), documentModel),
};
