import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import {
  useDocumentById,
  useDocumentsInSelectedDrive,
  useDocumentsInSelectedFolder,
  useSelectedDocument,
} from "@powerhousedao/reactor-browser";
import type {
  PipelineQueueAction,
  PipelineQueueDocument,
} from "knowledge-note/document-models/pipeline-queue/v1";
import {
  assertIsPipelineQueueDocument,
  isPipelineQueueDocument,
} from "./gen/document-schema.js";

/** Hook to get a PipelineQueue document by its id */
export function usePipelineQueueDocumentById(
  documentId: string | null | undefined,
):
  | [PipelineQueueDocument, DocumentDispatch<PipelineQueueAction>]
  | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isPipelineQueueDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected PipelineQueue document */
export function useSelectedPipelineQueueDocument(): [
  PipelineQueueDocument,
  DocumentDispatch<PipelineQueueAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsPipelineQueueDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all PipelineQueue documents in the selected drive */
export function usePipelineQueueDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isPipelineQueueDocument);
}

/** Hook to get all PipelineQueue documents in the selected folder */
export function usePipelineQueueDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isPipelineQueueDocument);
}
