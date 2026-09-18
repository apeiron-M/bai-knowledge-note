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
import { SourcePHStateSchema as SourcePHStateSchemaV1 } from "../../v1/gen/document-schema.js";
import { sourceDocumentType } from "./document-type.js";
import { SourceStateSchema } from "./schema/zod.js";
import type { SourceDocument, SourcePHState } from "./types.js";

/** Schema for validating the header object of a Source document */
export const SourceDocumentHeaderSchema = BaseDocumentHeaderSchema.extend({
  documentType: z.literal(sourceDocumentType),
});

/** Schema for validating the state object of a Source document */
export const SourcePHStateSchema = BaseDocumentStateSchema.extend({
  global: SourceStateSchema(),
});

export const SourceDocumentSchema = z.object({
  header: SourceDocumentHeaderSchema,
  state: SourcePHStateSchema,
  initialState: SourcePHStateSchema,
});

const SourcePHStateSchemasByVersion: Record<number, z.ZodType> = {
  1: SourcePHStateSchemaV1,
  2: SourcePHStateSchema,
};

const SourceDocumentSchemasByVersion: Record<number, z.ZodType> = {
  1: z.object({
    header: SourceDocumentHeaderSchema,
    state: SourcePHStateSchemaV1,
    initialState: SourcePHStateSchemaV1,
  }),
  2: SourceDocumentSchema,
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

function resolveSourcePHStateSchema(state: unknown): z.ZodType {
  const schema =
    SourcePHStateSchemasByVersion[stampedDocumentModelVersion(state)];
  return schema ?? SourcePHStateSchema;
}

function resolveSourceDocumentSchema(document: unknown): z.ZodType {
  const state =
    typeof document === "object" && document !== null
      ? (document as { state?: unknown }).state
      : undefined;
  const schema =
    SourceDocumentSchemasByVersion[stampedDocumentModelVersion(state)];
  return schema ?? SourceDocumentSchema;
}

/** Simple helper function to check if a state object is a Source document state object. Validates against the schema of the version the state is stamped with. */
export function isSourceState(state: unknown): state is SourcePHState {
  return resolveSourcePHStateSchema(state).safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a Source document state object. Validates against the schema of the version the state is stamped with. */
export function assertIsSourceState(
  state: unknown,
): asserts state is SourcePHState {
  resolveSourcePHStateSchema(state).parse(state);
}

/** Simple helper function to check if a document is a Source document. Validates against the schema of the version the document is stamped with, so documents on older versions remain valid until they are upgraded. */
export function isSourceDocument(
  document: unknown,
): document is SourceDocument {
  return resolveSourceDocumentSchema(document).safeParse(document).success;
}

/** Simple helper function to assert that a document is a Source document. Validates against the schema of the version the document is stamped with, so documents on older versions remain valid until they are upgraded. */
export function assertIsSourceDocument(
  document: unknown,
): asserts document is SourceDocument {
  resolveSourceDocumentSchema(document).parse(document);
}
