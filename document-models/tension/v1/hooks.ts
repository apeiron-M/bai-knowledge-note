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
  TensionAction,
  TensionDocument,
} from "document-models/tension/v1";
import {
  assertIsTensionDocument,
  isTensionDocument,
} from "./gen/document-schema.js";

/** Hook to get a Tension document by its id */
export function useTensionDocumentById(
  documentId: string | null | undefined,
): [TensionDocument, DocumentDispatch<TensionAction>] | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isTensionDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected Tension document */
export function useSelectedTensionDocument(): [
  TensionDocument,
  DocumentDispatch<TensionAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsTensionDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all Tension documents in the selected drive */
export function useTensionDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isTensionDocument);
}

/** Hook to get all Tension documents in the selected folder */
export function useTensionDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isTensionDocument);
}
