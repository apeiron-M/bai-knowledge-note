import { PHDocumentController } from "document-model/core";
import { KnowledgeGraph } from "../module.js";
import type { KnowledgeGraphAction, KnowledgeGraphPHState } from "./types.js";

export const KnowledgeGraphController = PHDocumentController.forDocumentModel<
  KnowledgeGraphPHState,
  KnowledgeGraphAction
>(KnowledgeGraph);
