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
  ResearchClaimAction,
  ResearchClaimDocument,
} from "document-models/research-claim/v1";
import {
  assertIsResearchClaimDocument,
  isResearchClaimDocument,
} from "./gen/document-schema.js";

/** Hook to get a ResearchClaim document by its id */
export function useResearchClaimDocumentById(
  documentId: string | null | undefined,
):
  | [ResearchClaimDocument, DocumentDispatch<ResearchClaimAction>]
  | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isResearchClaimDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected ResearchClaim document */
export function useSelectedResearchClaimDocument(): [
  ResearchClaimDocument,
  DocumentDispatch<ResearchClaimAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsResearchClaimDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all ResearchClaim documents in the selected drive */
export function useResearchClaimDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isResearchClaimDocument);
}

/** Hook to get all ResearchClaim documents in the selected folder */
export function useResearchClaimDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isResearchClaimDocument);
}
