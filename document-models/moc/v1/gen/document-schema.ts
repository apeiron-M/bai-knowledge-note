import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { mocDocumentType } from "./document-type.js";
import { MocStateSchema } from "./schema/zod.js";
import type { MocDocument, MocPHState } from "./types.js";

/** Schema for validating the header object of a Moc document */
export const MocDocumentHeaderSchema = BaseDocumentHeaderSchema.extend({
  documentType: z.literal(mocDocumentType),
});

/** Schema for validating the state object of a Moc document */
export const MocPHStateSchema = BaseDocumentStateSchema.extend({
  global: MocStateSchema(),
});

export const MocDocumentSchema = z.object({
  header: MocDocumentHeaderSchema,
  state: MocPHStateSchema,
  initialState: MocPHStateSchema,
});

/** Simple helper function to check if a state object is a Moc document state object */
export function isMocState(state: unknown): state is MocPHState {
  return MocPHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a Moc document state object */
export function assertIsMocState(state: unknown): asserts state is MocPHState {
  MocPHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a Moc document */
export function isMocDocument(document: unknown): document is MocDocument {
  return MocDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a Moc document */
export function assertIsMocDocument(
  document: unknown,
): asserts document is MocDocument {
  MocDocumentSchema.parse(document);
}
