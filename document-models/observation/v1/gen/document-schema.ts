import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { observationDocumentType } from "./document-type.js";
import { ObservationStateSchema } from "./schema/zod.js";
import type { ObservationDocument, ObservationPHState } from "./types.js";

/** Schema for validating the header object of a Observation document */
export const ObservationDocumentHeaderSchema = BaseDocumentHeaderSchema.extend({
  documentType: z.literal(observationDocumentType),
});

/** Schema for validating the state object of a Observation document */
export const ObservationPHStateSchema = BaseDocumentStateSchema.extend({
  global: ObservationStateSchema(),
});

export const ObservationDocumentSchema = z.object({
  header: ObservationDocumentHeaderSchema,
  state: ObservationPHStateSchema,
  initialState: ObservationPHStateSchema,
});

/** Simple helper function to check if a state object is a Observation document state object */
export function isObservationState(
  state: unknown,
): state is ObservationPHState {
  return ObservationPHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a Observation document state object */
export function assertIsObservationState(
  state: unknown,
): asserts state is ObservationPHState {
  ObservationPHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a Observation document */
export function isObservationDocument(
  document: unknown,
): document is ObservationDocument {
  return ObservationDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a Observation document */
export function assertIsObservationDocument(
  document: unknown,
): asserts document is ObservationDocument {
  ObservationDocumentSchema.parse(document);
}
