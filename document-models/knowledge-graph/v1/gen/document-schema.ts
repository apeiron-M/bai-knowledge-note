/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { knowledgeGraphDocumentType } from "./document-type.js";
import { KnowledgeGraphStateSchema } from "./schema/zod.js";
import type { KnowledgeGraphDocument, KnowledgeGraphPHState } from "./types.js";

/** Schema for validating the header object of a KnowledgeGraph document */
export const KnowledgeGraphDocumentHeaderSchema =
  BaseDocumentHeaderSchema.extend({
    documentType: z.literal(knowledgeGraphDocumentType),
  });

/** Schema for validating the state object of a KnowledgeGraph document */
export const KnowledgeGraphPHStateSchema = BaseDocumentStateSchema.extend({
  global: KnowledgeGraphStateSchema(),
});

export const KnowledgeGraphDocumentSchema = z.object({
  header: KnowledgeGraphDocumentHeaderSchema,
  state: KnowledgeGraphPHStateSchema,
  initialState: KnowledgeGraphPHStateSchema,
});

/** Simple helper function to check if a state object is a KnowledgeGraph document state object */
export function isKnowledgeGraphState(
  state: unknown,
): state is KnowledgeGraphPHState {
  return KnowledgeGraphPHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a KnowledgeGraph document state object */
export function assertIsKnowledgeGraphState(
  state: unknown,
): asserts state is KnowledgeGraphPHState {
  KnowledgeGraphPHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a KnowledgeGraph document */
export function isKnowledgeGraphDocument(
  document: unknown,
): document is KnowledgeGraphDocument {
  return KnowledgeGraphDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a KnowledgeGraph document */
export function assertIsKnowledgeGraphDocument(
  document: unknown,
): asserts document is KnowledgeGraphDocument {
  KnowledgeGraphDocumentSchema.parse(document);
}
