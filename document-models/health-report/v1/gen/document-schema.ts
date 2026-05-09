/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { healthReportDocumentType } from "./document-type.js";
import { HealthReportStateSchema } from "./schema/zod.js";
import type { HealthReportDocument, HealthReportPHState } from "./types.js";

/** Schema for validating the header object of a HealthReport document */
export const HealthReportDocumentHeaderSchema = BaseDocumentHeaderSchema.extend(
  {
    documentType: z.literal(healthReportDocumentType),
  },
);

/** Schema for validating the state object of a HealthReport document */
export const HealthReportPHStateSchema = BaseDocumentStateSchema.extend({
  global: HealthReportStateSchema(),
});

export const HealthReportDocumentSchema = z.object({
  header: HealthReportDocumentHeaderSchema,
  state: HealthReportPHStateSchema,
  initialState: HealthReportPHStateSchema,
});

/** Simple helper function to check if a state object is a HealthReport document state object */
export function isHealthReportState(
  state: unknown,
): state is HealthReportPHState {
  return HealthReportPHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a HealthReport document state object */
export function assertIsHealthReportState(
  state: unknown,
): asserts state is HealthReportPHState {
  HealthReportPHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a HealthReport document */
export function isHealthReportDocument(
  document: unknown,
): document is HealthReportDocument {
  return HealthReportDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a HealthReport document */
export function assertIsHealthReportDocument(
  document: unknown,
): asserts document is HealthReportDocument {
  HealthReportDocumentSchema.parse(document);
}
