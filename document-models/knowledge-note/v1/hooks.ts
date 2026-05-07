import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import {
  useDocumentById,
  useDocumentsInSelectedDrive,
  useDocumentsInSelectedFolder,
  useSelectedDocumentSafe,
} from "@powerhousedao/reactor-browser";
import type {
  KnowledgeNoteAction,
  KnowledgeNoteDocument,
} from "document-models/knowledge-note/v1";
import { isKnowledgeNoteDocument } from "./gen/document-schema.js";

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

/**
 * Hook to get the selected KnowledgeNote document.
 *
 * IMPORTANT: returns `[undefined, undefined]` when the document hasn't
 * loaded yet — historically this hook called `useSelectedDocument()`
 * which THROWS `NoSelectedDocumentError` whenever Connect's local
 * cache happens to not have the doc (frequent post-migration). That
 * threw inside the editor render path, the error boundary caught it,
 * and the page rendered blank with the user only seeing a URL change.
 *
 * Switched to `useSelectedDocumentSafe` which returns undefined.
 * Editors must guard for the undefined case with a loading state.
 */
export function useSelectedKnowledgeNoteDocument():
  | [KnowledgeNoteDocument, DocumentDispatch<KnowledgeNoteAction>]
  | [undefined, undefined] {
  const [document, dispatch] = useSelectedDocumentSafe();
  if (!isKnowledgeNoteDocument(document)) return [undefined, undefined];
  return [document, dispatch];
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
