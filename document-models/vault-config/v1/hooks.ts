/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import {
  useDocumentById,
  useDocumentsInSelectedDrive,
  useDocumentsInSelectedFolder,
  useSelectedDocument,
} from "@powerhousedao/reactor-browser";
import type {
  VaultConfigAction,
  VaultConfigDocument,
} from "document-models/vault-config/v1";
import {
  assertIsVaultConfigDocument,
  isVaultConfigDocument,
} from "./gen/document-schema.js";

/** Hook to get a VaultConfig document by its id */
export function useVaultConfigDocumentById(
  documentId: string | null | undefined,
):
  | [VaultConfigDocument, DocumentDispatch<VaultConfigAction>]
  | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isVaultConfigDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected VaultConfig document */
export function useSelectedVaultConfigDocument(): [
  VaultConfigDocument,
  DocumentDispatch<VaultConfigAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsVaultConfigDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all VaultConfig documents in the selected drive */
export function useVaultConfigDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isVaultConfigDocument);
}

/** Hook to get all VaultConfig documents in the selected folder */
export function useVaultConfigDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isVaultConfigDocument);
}
