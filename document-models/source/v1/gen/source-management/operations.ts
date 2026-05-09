/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { SourceGlobalState } from "../types.js";
import type {
  AddExtractedClaimAction,
  IngestSourceAction,
  RecordExtractionStatsAction,
  SetSourceStatusAction,
} from "./actions.js";

export interface SourceSourceManagementOperations {
  ingestSourceOperation: (
    state: SourceGlobalState,
    action: IngestSourceAction,
    dispatch?: SignalDispatch,
  ) => void;
  setSourceStatusOperation: (
    state: SourceGlobalState,
    action: SetSourceStatusAction,
    dispatch?: SignalDispatch,
  ) => void;
  addExtractedClaimOperation: (
    state: SourceGlobalState,
    action: AddExtractedClaimAction,
    dispatch?: SignalDispatch,
  ) => void;
  recordExtractionStatsOperation: (
    state: SourceGlobalState,
    action: RecordExtractionStatsAction,
    dispatch?: SignalDispatch,
  ) => void;
}
