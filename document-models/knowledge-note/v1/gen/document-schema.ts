/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { knowledgeNoteDocumentType } from "./document-type.js";
import { KnowledgeNoteStateSchema } from "./schema/zod.js";
import type { KnowledgeNoteDocument, KnowledgeNotePHState } from "./types.js";

/** Schema for validating the header object of a KnowledgeNote document */
export const KnowledgeNoteDocumentHeaderSchema =
  BaseDocumentHeaderSchema.extend({
    documentType: z.literal(knowledgeNoteDocumentType),
  });

/** Schema for validating the state object of a KnowledgeNote document */
export const KnowledgeNotePHStateSchema = BaseDocumentStateSchema.extend({
  global: KnowledgeNoteStateSchema(),
});

export const KnowledgeNoteDocumentSchema = z.object({
  header: KnowledgeNoteDocumentHeaderSchema,
  state: KnowledgeNotePHStateSchema,
  initialState: KnowledgeNotePHStateSchema,
});

/** Simple helper function to check if a state object is a KnowledgeNote document state object */
export function isKnowledgeNoteState(
  state: unknown,
): state is KnowledgeNotePHState {
  return KnowledgeNotePHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a KnowledgeNote document state object */
export function assertIsKnowledgeNoteState(
  state: unknown,
): asserts state is KnowledgeNotePHState {
  KnowledgeNotePHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a KnowledgeNote document */
export function isKnowledgeNoteDocument(
  document: unknown,
): document is KnowledgeNoteDocument {
  return KnowledgeNoteDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a KnowledgeNote document */
export function assertIsKnowledgeNoteDocument(
  document: unknown,
): asserts document is KnowledgeNoteDocument {
  KnowledgeNoteDocumentSchema.parse(document);
}
