import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import {
  useDocumentById,
  useDocumentsInSelectedDrive,
  useDocumentsInSelectedFolder,
  useSelectedDocument,
} from "@powerhousedao/reactor-browser";
import type {
  HealthReportAction,
  HealthReportDocument,
} from "@powerhousedao/knowledge-note/document-models/health-report/v1";
import {
  assertIsHealthReportDocument,
  isHealthReportDocument,
} from "./gen/document-schema.js";

/** Hook to get a HealthReport document by its id */
export function useHealthReportDocumentById(
  documentId: string | null | undefined,
):
  | [HealthReportDocument, DocumentDispatch<HealthReportAction>]
  | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isHealthReportDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected HealthReport document */
export function useSelectedHealthReportDocument(): [
  HealthReportDocument,
  DocumentDispatch<HealthReportAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsHealthReportDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all HealthReport documents in the selected drive */
export function useHealthReportDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isHealthReportDocument);
}

/** Hook to get all HealthReport documents in the selected folder */
export function useHealthReportDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isHealthReportDocument);
}
