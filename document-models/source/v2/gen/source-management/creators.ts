/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddAttachmentInputSchema,
  AddExtractedClaimInputSchema,
  AttachOriginalFileInputSchema,
  IngestSourceInputSchema,
  RecordExtractionStatsInputSchema,
  RemoveAttachmentInputSchema,
  RemoveExtractedClaimInputSchema,
  SetSourceStatusInputSchema,
} from "../schema/zod.js";
import type {
  AddAttachmentInput,
  AddExtractedClaimInput,
  AttachOriginalFileInput,
  IngestSourceInput,
  RecordExtractionStatsInput,
  RemoveAttachmentInput,
  RemoveExtractedClaimInput,
  SetSourceStatusInput,
} from "../types.js";
import type {
  AddAttachmentAction,
  AddExtractedClaimAction,
  AttachOriginalFileAction,
  IngestSourceAction,
  RecordExtractionStatsAction,
  RemoveAttachmentAction,
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

export const attachOriginalFile = (input: AttachOriginalFileInput) =>
  createAction<AttachOriginalFileAction>(
    "ATTACH_ORIGINAL_FILE",
    { ...input },
    undefined,
    AttachOriginalFileInputSchema,
    "global",
  );

export const addAttachment = (input: AddAttachmentInput) =>
  createAction<AddAttachmentAction>(
    "ADD_ATTACHMENT",
    { ...input },
    undefined,
    AddAttachmentInputSchema,
    "global",
  );

export const removeAttachment = (input: RemoveAttachmentInput) =>
  createAction<RemoveAttachmentAction>(
    "REMOVE_ATTACHMENT",
    { ...input },
    undefined,
    RemoveAttachmentInputSchema,
    "global",
  );
