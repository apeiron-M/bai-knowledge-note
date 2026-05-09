/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
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

/** Simple helper function to check if a state object is a PipelineQueue document state object */
export function isPipelineQueueState(
  state: unknown,
): state is PipelineQueuePHState {
  return PipelineQueuePHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a PipelineQueue document state object */
export function assertIsPipelineQueueState(
  state: unknown,
): asserts state is PipelineQueuePHState {
  PipelineQueuePHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a PipelineQueue document */
export function isPipelineQueueDocument(
  document: unknown,
): document is PipelineQueueDocument {
  return PipelineQueueDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a PipelineQueue document */
export function assertIsPipelineQueueDocument(
  document: unknown,
): asserts document is PipelineQueueDocument {
  PipelineQueueDocumentSchema.parse(document);
}
