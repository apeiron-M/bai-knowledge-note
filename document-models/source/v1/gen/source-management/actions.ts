/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddExtractedClaimInput,
  AttachOriginalFileInput,
  IngestSourceInput,
  RecordExtractionStatsInput,
  RemoveExtractedClaimInput,
  SetSourceStatusInput,
} from "../types.js";

export type IngestSourceAction = Action & {
  type: "INGEST_SOURCE";
  input: IngestSourceInput;
};
export type SetSourceStatusAction = Action & {
  type: "SET_SOURCE_STATUS";
  input: SetSourceStatusInput;
};
export type AddExtractedClaimAction = Action & {
  type: "ADD_EXTRACTED_CLAIM";
  input: AddExtractedClaimInput;
};
export type RecordExtractionStatsAction = Action & {
  type: "RECORD_EXTRACTION_STATS";
  input: RecordExtractionStatsInput;
};
export type RemoveExtractedClaimAction = Action & {
  type: "REMOVE_EXTRACTED_CLAIM";
  input: RemoveExtractedClaimInput;
};
export type AttachOriginalFileAction = Action & {
  type: "ATTACH_ORIGINAL_FILE";
  input: AttachOriginalFileInput;
};

export type SourceSourceManagementAction =
  | IngestSourceAction
  | SetSourceStatusAction
  | AddExtractedClaimAction
  | RecordExtractionStatsAction
  | RemoveExtractedClaimAction
  | AttachOriginalFileAction;
