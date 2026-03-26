import { createAction } from "document-model/core";
import {
  SubmitForReviewInputSchema,
  ApproveNoteInputSchema,
  RejectNoteInputSchema,
  ArchiveNoteInputSchema,
  RestoreNoteInputSchema,
} from "../schema/zod.js";
import type {
  SubmitForReviewInput,
  ApproveNoteInput,
  RejectNoteInput,
  ArchiveNoteInput,
  RestoreNoteInput,
} from "../types.js";
import type {
  SubmitForReviewAction,
  ApproveNoteAction,
  RejectNoteAction,
  ArchiveNoteAction,
  RestoreNoteAction,
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
