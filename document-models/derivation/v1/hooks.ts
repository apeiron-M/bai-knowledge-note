import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import {
  useDocumentById,
  useDocumentsInSelectedDrive,
  useDocumentsInSelectedFolder,
  useSelectedDocument,
} from "@powerhousedao/reactor-browser";
import type {
  DerivationAction,
  DerivationDocument,
} from "@powerhousedao/knowledge-note/document-models/derivation/v1";
import {
  assertIsDerivationDocument,
  isDerivationDocument,
} from "./gen/document-schema.js";

/** Hook to get a Derivation document by its id */
export function useDerivationDocumentById(
  documentId: string | null | undefined,
):
  | [DerivationDocument, DocumentDispatch<DerivationAction>]
  | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isDerivationDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected Derivation document */
export function useSelectedDerivationDocument(): [
  DerivationDocument,
  DocumentDispatch<DerivationAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsDerivationDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all Derivation documents in the selected drive */
export function useDerivationDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isDerivationDocument);
}

/** Hook to get all Derivation documents in the selected folder */
export function useDerivationDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isDerivationDocument);
}
