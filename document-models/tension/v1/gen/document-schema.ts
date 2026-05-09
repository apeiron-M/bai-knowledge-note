/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { tensionDocumentType } from "./document-type.js";
import { TensionStateSchema } from "./schema/zod.js";
import type { TensionDocument, TensionPHState } from "./types.js";

/** Schema for validating the header object of a Tension document */
export const TensionDocumentHeaderSchema = BaseDocumentHeaderSchema.extend({
  documentType: z.literal(tensionDocumentType),
});

/** Schema for validating the state object of a Tension document */
export const TensionPHStateSchema = BaseDocumentStateSchema.extend({
  global: TensionStateSchema(),
});

export const TensionDocumentSchema = z.object({
  header: TensionDocumentHeaderSchema,
  state: TensionPHStateSchema,
  initialState: TensionPHStateSchema,
});

/** Simple helper function to check if a state object is a Tension document state object */
export function isTensionState(state: unknown): state is TensionPHState {
  return TensionPHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a Tension document state object */
export function assertIsTensionState(
  state: unknown,
): asserts state is TensionPHState {
  TensionPHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a Tension document */
export function isTensionDocument(
  document: unknown,
): document is TensionDocument {
  return TensionDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a Tension document */
export function assertIsTensionDocument(
  document: unknown,
): asserts document is TensionDocument {
  TensionDocumentSchema.parse(document);
}
