import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { researchClaimDocumentType } from "./document-type.js";
import { ResearchClaimStateSchema } from "./schema/zod.js";
import type { ResearchClaimDocument, ResearchClaimPHState } from "./types.js";

/** Schema for validating the header object of a ResearchClaim document */
export const ResearchClaimDocumentHeaderSchema =
  BaseDocumentHeaderSchema.extend({
    documentType: z.literal(researchClaimDocumentType),
  });

/** Schema for validating the state object of a ResearchClaim document */
export const ResearchClaimPHStateSchema = BaseDocumentStateSchema.extend({
  global: ResearchClaimStateSchema(),
});

export const ResearchClaimDocumentSchema = z.object({
  header: ResearchClaimDocumentHeaderSchema,
  state: ResearchClaimPHStateSchema,
  initialState: ResearchClaimPHStateSchema,
});

/** Simple helper function to check if a state object is a ResearchClaim document state object */
export function isResearchClaimState(
  state: unknown,
): state is ResearchClaimPHState {
  return ResearchClaimPHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a ResearchClaim document state object */
export function assertIsResearchClaimState(
  state: unknown,
): asserts state is ResearchClaimPHState {
  ResearchClaimPHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a ResearchClaim document */
export function isResearchClaimDocument(
  document: unknown,
): document is ResearchClaimDocument {
  return ResearchClaimDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a ResearchClaim document */
export function assertIsResearchClaimDocument(
  document: unknown,
): asserts document is ResearchClaimDocument {
  ResearchClaimDocumentSchema.parse(document);
}
