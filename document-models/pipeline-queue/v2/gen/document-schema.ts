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
import { PipelineQueuePHStateSchema as PipelineQueuePHStateSchemaV1 } from "../../v1/gen/document-schema.js";
import { pipelineQueueDocumentType } from "./document-type.js";
import { PipelineQueueStateSchema } from "./schema/zod.js";
import type { PipelineQueueDocument, PipelineQueuePHState } from "./types.js";

/** Schema for validating the header object of a PipelineQueue document */
export const PipelineQueueDocumentHeaderSchema =
  BaseDocumentHeaderSchema.extend({
    documentType: z.literal(pipelineQueueDocumentType),
  });

/** Schema for validating the state object of a PipelineQueue document */
export const PipelineQueuePHStateSchema = BaseDocumentStateSchema.extend({
  global: PipelineQueueStateSchema(),
});

export const PipelineQueueDocumentSchema = z.object({
  header: PipelineQueueDocumentHeaderSchema,
  state: PipelineQueuePHStateSchema,
  initialState: PipelineQueuePHStateSchema,
});

const PipelineQueuePHStateSchemasByVersion: Record<number, z.ZodType> = {
  1: PipelineQueuePHStateSchemaV1,
  2: PipelineQueuePHStateSchema,
};

const PipelineQueueDocumentSchemasByVersion: Record<number, z.ZodType> = {
  1: z.object({
    header: PipelineQueueDocumentHeaderSchema,
    state: PipelineQueuePHStateSchemaV1,
    initialState: PipelineQueuePHStateSchemaV1,
  }),
  2: PipelineQueueDocumentSchema,
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

function resolvePipelineQueuePHStateSchema(state: unknown): z.ZodType {
  const schema =
    PipelineQueuePHStateSchemasByVersion[stampedDocumentModelVersion(state)];
  return schema ?? PipelineQueuePHStateSchema;
}

function resolvePipelineQueueDocumentSchema(document: unknown): z.ZodType {
  const state =
    typeof document === "object" && document !== null
      ? (document as { state?: unknown }).state
      : undefined;
  const schema =
    PipelineQueueDocumentSchemasByVersion[stampedDocumentModelVersion(state)];
  return schema ?? PipelineQueueDocumentSchema;
}

/** Simple helper function to check if a state object is a PipelineQueue document state object. Validates against the schema of the version the state is stamped with. */
export function isPipelineQueueState(
  state: unknown,
): state is PipelineQueuePHState {
  return resolvePipelineQueuePHStateSchema(state).safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a PipelineQueue document state object. Validates against the schema of the version the state is stamped with. */
export function assertIsPipelineQueueState(
  state: unknown,
): asserts state is PipelineQueuePHState {
  resolvePipelineQueuePHStateSchema(state).parse(state);
}

/** Simple helper function to check if a document is a PipelineQueue document. Validates against the schema of the version the document is stamped with, so documents on older versions remain valid until they are upgraded. */
export function isPipelineQueueDocument(
  document: unknown,
): document is PipelineQueueDocument {
  return resolvePipelineQueueDocumentSchema(document).safeParse(document)
    .success;
}

/** Simple helper function to assert that a document is a PipelineQueue document. Validates against the schema of the version the document is stamped with, so documents on older versions remain valid until they are upgraded. */
export function assertIsPipelineQueueDocument(
  document: unknown,
): asserts document is PipelineQueueDocument {
  resolvePipelineQueueDocumentSchema(document).parse(document);
}
