import type { DocumentModelModule } from "document-model";
import { KnowledgeNote } from "./knowledge-note/module.js";

export const documentModels: DocumentModelModule<any>[] = [
  KnowledgeNote,
];
