import type { Action } from "document-model";
import type {
  IngestSourceInput,
  SetSourceStatusInput,
  AddExtractedClaimInput,
  RecordExtractionStatsInput,
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

export type SourceSourceManagementAction =
  | IngestSourceAction
  | SetSourceStatusAction
  | AddExtractedClaimAction
  | RecordExtractionStatsAction;
