/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  ApproveNoteInputSchema,
  ArchiveNoteInputSchema,
  RejectNoteInputSchema,
  RestoreNoteInputSchema,
  SubmitForReviewInputSchema,
} from "../schema/zod.js";
import type {
  ApproveNoteInput,
  ArchiveNoteInput,
  RejectNoteInput,
  RestoreNoteInput,
  SubmitForReviewInput,
} from "../types.js";
import type {
  ApproveNoteAction,
  ArchiveNoteAction,
  RejectNoteAction,
  RestoreNoteAction,
  SubmitForReviewAction,
} from "./actions.js";

export const submitForReview = (input: SubmitForReviewInput) =>
  createAction<SubmitForReviewAction>(
    "SUBMIT_FOR_REVIEW",
    { ...input },
    undefined,
    SubmitForReviewInputSchema,
    "global",
  );

export const approveNote = (input: ApproveNoteInput) =>
  createAction<ApproveNoteAction>(
    "APPROVE_NOTE",
    { ...input },
    undefined,
    ApproveNoteInputSchema,
    "global",
  );

export const rejectNote = (input: RejectNoteInput) =>
  createAction<RejectNoteAction>(
    "REJECT_NOTE",
    { ...input },
    undefined,
    RejectNoteInputSchema,
    "global",
  );

export const archiveNote = (input: ArchiveNoteInput) =>
  createAction<ArchiveNoteAction>(
    "ARCHIVE_NOTE",
    { ...input },
    undefined,
    ArchiveNoteInputSchema,
    "global",
  );

export const restoreNote = (input: RestoreNoteInput) =>
  createAction<RestoreNoteAction>(
    "RESTORE_NOTE",
    { ...input },
    undefined,
    RestoreNoteInputSchema,
    "global",
  );
