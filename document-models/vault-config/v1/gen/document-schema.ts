/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { vaultConfigDocumentType } from "./document-type.js";
import { VaultConfigStateSchema } from "./schema/zod.js";
import type { VaultConfigDocument, VaultConfigPHState } from "./types.js";

/** Schema for validating the header object of a VaultConfig document */
export const VaultConfigDocumentHeaderSchema = BaseDocumentHeaderSchema.extend({
  documentType: z.literal(vaultConfigDocumentType),
});

/** Schema for validating the state object of a VaultConfig document */
export const VaultConfigPHStateSchema = BaseDocumentStateSchema.extend({
  global: VaultConfigStateSchema(),
});

export const VaultConfigDocumentSchema = z.object({
  header: VaultConfigDocumentHeaderSchema,
  state: VaultConfigPHStateSchema,
  initialState: VaultConfigPHStateSchema,
});

/** Simple helper function to check if a state object is a VaultConfig document state object */
export function isVaultConfigState(
  state: unknown,
): state is VaultConfigPHState {
  return VaultConfigPHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a VaultConfig document state object */
export function assertIsVaultConfigState(
  state: unknown,
): asserts state is VaultConfigPHState {
  VaultConfigPHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a VaultConfig document */
export function isVaultConfigDocument(
  document: unknown,
): document is VaultConfigDocument {
  return VaultConfigDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a VaultConfig document */
export function assertIsVaultConfigDocument(
  document: unknown,
): asserts document is VaultConfigDocument {
  VaultConfigDocumentSchema.parse(document);
}
