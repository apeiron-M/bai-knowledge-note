import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { derivationDocumentType } from "./document-type.js";
import { DerivationStateSchema } from "./schema/zod.js";
import type { DerivationDocument, DerivationPHState } from "./types.js";

/** Schema for validating the header object of a Derivation document */
export const DerivationDocumentHeaderSchema = BaseDocumentHeaderSchema.extend({
  documentType: z.literal(derivationDocumentType),
});

/** Schema for validating the state object of a Derivation document */
export const DerivationPHStateSchema = BaseDocumentStateSchema.extend({
  global: DerivationStateSchema(),
});

export const DerivationDocumentSchema = z.object({
  header: DerivationDocumentHeaderSchema,
  state: DerivationPHStateSchema,
  initialState: DerivationPHStateSchema,
});

/** Simple helper function to check if a state object is a Derivation document state object */
export function isDerivationState(state: unknown): state is DerivationPHState {
  return DerivationPHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a Derivation document state object */
export function assertIsDerivationState(
  state: unknown,
): asserts state is DerivationPHState {
  DerivationPHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a Derivation document */
export function isDerivationDocument(
  document: unknown,
): document is DerivationDocument {
  return DerivationDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a Derivation document */
export function assertIsDerivationDocument(
  document: unknown,
): asserts document is DerivationDocument {
  DerivationDocumentSchema.parse(document);
}
