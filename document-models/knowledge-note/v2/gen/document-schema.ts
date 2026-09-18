/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
  normalizeDocumentModelVersion,
} from "document-model";
import { z } from "zod";
import { KnowledgeNotePHStateSchema as KnowledgeNotePHStateSchemaV1 } from "../../v1/gen/document-schema.js";
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

const KnowledgeNotePHStateSchemasByVersion: Record<number, z.ZodType> = {
  1: KnowledgeNotePHStateSchemaV1,
  2: KnowledgeNotePHStateSchema,
};

const KnowledgeNoteDocumentSchemasByVersion: Record<number, z.ZodType> = {
  1: z.object({
    header: KnowledgeNoteDocumentHeaderSchema,
    state: KnowledgeNotePHStateSchemaV1,
    initialState: KnowledgeNotePHStateSchemaV1,
  }),
  2: KnowledgeNoteDocumentSchema,
};

/** The document model version stamped in a state's document scope. States stamped with 0 or nothing predate versioning and are treated as version 1. */
function stampedDocumentModelVersion(state: unknown): number {
  if (typeof state !== "object" || state === null) return 1;
  const documentScope = (state as { document?: unknown }).document;
  if (typeof documentScope !== "object" || documentScope === null) return 1;
  const version = (documentScope as { version?: unknown }).version;
  return normalizeDocumentModelVersion(
    typeof version === "number" ? version : undefined,
  );
}

function resolveKnowledgeNotePHStateSchema(state: unknown): z.ZodType {
  const schema =
    KnowledgeNotePHStateSchemasByVersion[stampedDocumentModelVersion(state)];
  return schema ?? KnowledgeNotePHStateSchema;
}

function resolveKnowledgeNoteDocumentSchema(document: unknown): z.ZodType {
  const state =
    typeof document === "object" && document !== null
      ? (document as { state?: unknown }).state
      : undefined;
  const schema =
    KnowledgeNoteDocumentSchemasByVersion[stampedDocumentModelVersion(state)];
  return schema ?? KnowledgeNoteDocumentSchema;
}

/** Simple helper function to check if a state object is a KnowledgeNote document state object. Validates against the schema of the version the state is stamped with. */
export function isKnowledgeNoteState(
  state: unknown,
): state is KnowledgeNotePHState {
  return resolveKnowledgeNotePHStateSchema(state).safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a KnowledgeNote document state object. Validates against the schema of the version the state is stamped with. */
export function assertIsKnowledgeNoteState(
  state: unknown,
): asserts state is KnowledgeNotePHState {
  resolveKnowledgeNotePHStateSchema(state).parse(state);
}

/** Simple helper function to check if a document is a KnowledgeNote document. Validates against the schema of the version the document is stamped with, so documents on older versions remain valid until they are upgraded. */
export function isKnowledgeNoteDocument(
  document: unknown,
): document is KnowledgeNoteDocument {
  return resolveKnowledgeNoteDocumentSchema(document).safeParse(document)
    .success;
}

/** Simple helper function to assert that a document is a KnowledgeNote document. Validates against the schema of the version the document is stamped with, so documents on older versions remain valid until they are upgraded. */
export function assertIsKnowledgeNoteDocument(
  document: unknown,
): asserts document is KnowledgeNoteDocument {
  resolveKnowledgeNoteDocumentSchema(document).parse(document);
}
