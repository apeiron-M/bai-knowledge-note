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
import { VaultConfigPHStateSchema as VaultConfigPHStateSchemaV1 } from "../../v1/gen/document-schema.js";
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

const VaultConfigPHStateSchemasByVersion: Record<number, z.ZodType> = {
  1: VaultConfigPHStateSchemaV1,
  2: VaultConfigPHStateSchema,
};

const VaultConfigDocumentSchemasByVersion: Record<number, z.ZodType> = {
  1: z.object({
    header: VaultConfigDocumentHeaderSchema,
    state: VaultConfigPHStateSchemaV1,
    initialState: VaultConfigPHStateSchemaV1,
  }),
  2: VaultConfigDocumentSchema,
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

function resolveVaultConfigPHStateSchema(state: unknown): z.ZodType {
  const schema =
    VaultConfigPHStateSchemasByVersion[stampedDocumentModelVersion(state)];
  return schema ?? VaultConfigPHStateSchema;
}

function resolveVaultConfigDocumentSchema(document: unknown): z.ZodType {
  const state =
    typeof document === "object" && document !== null
      ? (document as { state?: unknown }).state
      : undefined;
  const schema =
    VaultConfigDocumentSchemasByVersion[stampedDocumentModelVersion(state)];
  return schema ?? VaultConfigDocumentSchema;
}

/** Simple helper function to check if a state object is a VaultConfig document state object. Validates against the schema of the version the state is stamped with. */
export function isVaultConfigState(
  state: unknown,
): state is VaultConfigPHState {
  return resolveVaultConfigPHStateSchema(state).safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a VaultConfig document state object. Validates against the schema of the version the state is stamped with. */
export function assertIsVaultConfigState(
  state: unknown,
): asserts state is VaultConfigPHState {
  resolveVaultConfigPHStateSchema(state).parse(state);
}

/** Simple helper function to check if a document is a VaultConfig document. Validates against the schema of the version the document is stamped with, so documents on older versions remain valid until they are upgraded. */
export function isVaultConfigDocument(
  document: unknown,
): document is VaultConfigDocument {
  return resolveVaultConfigDocumentSchema(document).safeParse(document).success;
}

/** Simple helper function to assert that a document is a VaultConfig document. Validates against the schema of the version the document is stamped with, so documents on older versions remain valid until they are upgraded. */
export function assertIsVaultConfigDocument(
  document: unknown,
): asserts document is VaultConfigDocument {
  resolveVaultConfigDocumentSchema(document).parse(document);
}
