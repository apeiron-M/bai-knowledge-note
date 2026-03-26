import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
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

/** Simple helper function to check if a state object is a Source document state object */
export function isSourceState(state: unknown): state is SourcePHState {
  return SourcePHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a Source document state object */
export function assertIsSourceState(
  state: unknown,
): asserts state is SourcePHState {
  SourcePHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a Source document */
export function isSourceDocument(
  document: unknown,
): document is SourceDocument {
  return SourceDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a Source document */
export function assertIsSourceDocument(
  document: unknown,
): asserts document is SourceDocument {
  SourceDocumentSchema.parse(document);
}
