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
  ProjectAction,
  ProjectDocument,
} from "document-models/project/v1";
import {
  assertIsProjectDocument,
  isProjectDocument,
} from "./gen/document-schema.js";

/** Hook to get a Project document by its id */
export function useProjectDocumentById(
  documentId: string | null | undefined,
): [ProjectDocument, DocumentDispatch<ProjectAction>] | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isProjectDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected Project document */
export function useSelectedProjectDocument(): [
  ProjectDocument,
  DocumentDispatch<ProjectAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsProjectDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all Project documents in the selected drive */
export function useProjectDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isProjectDocument);
}

/** Hook to get all Project documents in the selected folder */
export function useProjectDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isProjectDocument);
}
