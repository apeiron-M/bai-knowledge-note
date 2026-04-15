import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import {
  useDocumentById,
  useDocumentsInSelectedDrive,
  useDocumentsInSelectedFolder,
  useSelectedDocument,
} from "@powerhousedao/reactor-browser";
import type {
  ObservationAction,
  ObservationDocument,
} from "document-models/observation/v1";
import {
  assertIsObservationDocument,
  isObservationDocument,
} from "./gen/document-schema.js";

/** Hook to get a Observation document by its id */
export function useObservationDocumentById(
  documentId: string | null | undefined,
):
  | [ObservationDocument, DocumentDispatch<ObservationAction>]
  | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isObservationDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected Observation document */
export function useSelectedObservationDocument(): [
  ObservationDocument,
  DocumentDispatch<ObservationAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsObservationDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all Observation documents in the selected drive */
export function useObservationDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isObservationDocument);
}

/** Hook to get all Observation documents in the selected folder */
export function useObservationDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isObservationDocument);
}
