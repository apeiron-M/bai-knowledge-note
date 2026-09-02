/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddExtractedClaimInputSchema,
  IngestSourceInputSchema,
  RecordExtractionStatsInputSchema,
  RemoveExtractedClaimInputSchema,
  SetSourceStatusInputSchema,
} from "../schema/zod.js";
import type {
  AddExtractedClaimInput,
  IngestSourceInput,
  RecordExtractionStatsInput,
  RemoveExtractedClaimInput,
  SetSourceStatusInput,
} from "../types.js";
import type {
  AddExtractedClaimAction,
  IngestSourceAction,
  RecordExtractionStatsAction,
  RemoveExtractedClaimAction,
  SetSourceStatusAction,
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

export const removeExtractedClaim = (input: RemoveExtractedClaimInput) =>
  createAction<RemoveExtractedClaimAction>(
    "REMOVE_EXTRACTED_CLAIM",
    { ...input },
    undefined,
    RemoveExtractedClaimInputSchema,
    "global",
  );
