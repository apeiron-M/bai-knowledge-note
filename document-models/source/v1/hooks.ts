import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import {
  useDocumentById,
  useDocumentsInSelectedDrive,
  useDocumentsInSelectedFolder,
  useSelectedDocument,
} from "@powerhousedao/reactor-browser";
import type {
  SourceAction,
  SourceDocument,
} from "@powerhousedao/knowledge-note/document-models/source/v1";
import {
  assertIsSourceDocument,
  isSourceDocument,
} from "./gen/document-schema.js";

/** Hook to get a Source document by its id */
export function useSourceDocumentById(
  documentId: string | null | undefined,
): [SourceDocument, DocumentDispatch<SourceAction>] | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isSourceDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected Source document */
export function useSelectedSourceDocument(): [
  SourceDocument,
  DocumentDispatch<SourceAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsSourceDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all Source documents in the selected drive */
export function useSourceDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isSourceDocument);
}

/** Hook to get all Source documents in the selected folder */
export function useSourceDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isSourceDocument);
}
