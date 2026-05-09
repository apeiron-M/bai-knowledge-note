/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { PHDocumentController } from "document-model";
import { KnowledgeGraph } from "../module.js";
import type { KnowledgeGraphAction, KnowledgeGraphPHState } from "./types.js";

export const KnowledgeGraphController = PHDocumentController.forDocumentModel<
  KnowledgeGraphPHState,
  KnowledgeGraphAction
>(KnowledgeGraph);
