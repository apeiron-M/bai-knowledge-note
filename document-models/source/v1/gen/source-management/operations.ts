import { type SignalDispatch } from "document-model";
import type {
  IngestSourceAction,
  SetSourceStatusAction,
  AddExtractedClaimAction,
  RecordExtractionStatsAction,
} from "./actions.js";
import type { SourceState } from "../types.js";

export interface SourceSourceManagementOperations {
  ingestSourceOperation: (
    state: SourceState,
    action: IngestSourceAction,
    dispatch?: SignalDispatch,
  ) => void;
  setSourceStatusOperation: (
    state: SourceState,
    action: SetSourceStatusAction,
    dispatch?: SignalDispatch,
  ) => void;
  addExtractedClaimOperation: (
    state: SourceState,
    action: AddExtractedClaimAction,
    dispatch?: SignalDispatch,
  ) => void;
  recordExtractionStatsOperation: (
    state: SourceState,
    action: RecordExtractionStatsAction,
    dispatch?: SignalDispatch,
  ) => void;
}
