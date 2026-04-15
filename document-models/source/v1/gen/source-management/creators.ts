import { createAction } from "document-model";
import {
  IngestSourceInputSchema,
  SetSourceStatusInputSchema,
  AddExtractedClaimInputSchema,
  RecordExtractionStatsInputSchema,
} from "../schema/zod.js";
import type {
  IngestSourceInput,
  SetSourceStatusInput,
  AddExtractedClaimInput,
  RecordExtractionStatsInput,
} from "../types.js";
import type {
  IngestSourceAction,
  SetSourceStatusAction,
  AddExtractedClaimAction,
  RecordExtractionStatsAction,
} from "./actions.js";

export const ingestSource = (input: IngestSourceInput) =>
  createAction<IngestSourceAction>(
    "INGEST_SOURCE",
    { ...input },
    undefined,
    IngestSourceInputSchema,
    "global",
  );

export const setSourceStatus = (input: SetSourceStatusInput) =>
  createAction<SetSourceStatusAction>(
    "SET_SOURCE_STATUS",
    { ...input },
    undefined,
    SetSourceStatusInputSchema,
    "global",
  );

export const addExtractedClaim = (input: AddExtractedClaimInput) =>
  createAction<AddExtractedClaimAction>(
    "ADD_EXTRACTED_CLAIM",
    { ...input },
    undefined,
    AddExtractedClaimInputSchema,
    "global",
  );

export const recordExtractionStats = (input: RecordExtractionStatsInput) =>
  createAction<RecordExtractionStatsAction>(
    "RECORD_EXTRACTION_STATS",
    { ...input },
    undefined,
    RecordExtractionStatsInputSchema,
    "global",
  );
