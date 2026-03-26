import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import {
  useDocumentById,
  useDocumentsInSelectedDrive,
  useDocumentsInSelectedFolder,
  useSelectedDocument,
} from "@powerhousedao/reactor-browser";
import type {
  KnowledgeNoteAction,
  KnowledgeNoteDocument,
} from "knowledge-note/document-models/knowledge-note/v1";
import {
  assertIsKnowledgeNoteDocument,
  isKnowledgeNoteDocument,
} from "./gen/document-schema.js";

/** Hook to get a KnowledgeNote document by its id */
export function useKnowledgeNoteDocumentById(
  documentId: string | null | undefined,
):
  | [KnowledgeNoteDocument, DocumentDispatch<KnowledgeNoteAction>]
  | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isKnowledgeNoteDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected KnowledgeNote document */
export function useSelectedKnowledgeNoteDocument(): [
  KnowledgeNoteDocument,
  DocumentDispatch<KnowledgeNoteAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsKnowledgeNoteDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all KnowledgeNote documents in the selected drive */
export function useKnowledgeNoteDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isKnowledgeNoteDocument);
}

/** Hook to get all KnowledgeNote documents in the selected folder */
export function useKnowledgeNoteDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isKnowledgeNoteDocument);
}
