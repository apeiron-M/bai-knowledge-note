import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import {
  useDocumentById,
  useDocumentsInSelectedDrive,
  useDocumentsInSelectedFolder,
  useSelectedDocument,
} from "@powerhousedao/reactor-browser";
import type {
  MocAction,
  MocDocument,
} from "knowledge-note/document-models/moc/v1";
import { assertIsMocDocument, isMocDocument } from "./gen/document-schema.js";

/** Hook to get a Moc document by its id */
export function useMocDocumentById(
  documentId: string | null | undefined,
): [MocDocument, DocumentDispatch<MocAction>] | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isMocDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected Moc document */
export function useSelectedMocDocument(): [
  MocDocument,
  DocumentDispatch<MocAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsMocDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all Moc documents in the selected drive */
export function useMocDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isMocDocument);
}

/** Hook to get all Moc documents in the selected folder */
export function useMocDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isMocDocument);
}
