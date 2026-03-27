import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import {
  useDocumentById,
  useDocumentsInSelectedDrive,
  useDocumentsInSelectedFolder,
  useSelectedDocument,
} from "@powerhousedao/reactor-browser";
import type {
  KnowledgeGraphAction,
  KnowledgeGraphDocument,
} from "@powerhousedao/knowledge-note/document-models/knowledge-graph/v1";
import {
  assertIsKnowledgeGraphDocument,
  isKnowledgeGraphDocument,
} from "./gen/document-schema.js";

/** Hook to get a KnowledgeGraph document by its id */
export function useKnowledgeGraphDocumentById(
  documentId: string | null | undefined,
):
  | [KnowledgeGraphDocument, DocumentDispatch<KnowledgeGraphAction>]
  | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isKnowledgeGraphDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected KnowledgeGraph document */
export function useSelectedKnowledgeGraphDocument(): [
  KnowledgeGraphDocument,
  DocumentDispatch<KnowledgeGraphAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsKnowledgeGraphDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all KnowledgeGraph documents in the selected drive */
export function useKnowledgeGraphDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isKnowledgeGraphDocument);
}

/** Hook to get all KnowledgeGraph documents in the selected folder */
export function useKnowledgeGraphDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isKnowledgeGraphDocument);
}
