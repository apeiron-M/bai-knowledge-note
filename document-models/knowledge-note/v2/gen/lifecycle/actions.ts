/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  ApproveNoteInput,
  ArchiveNoteInput,
  RejectNoteInput,
  RestoreNoteInput,
  SubmitForReviewInput,
} from "../types.js";

export type SubmitForReviewAction = Action & {
  type: "SUBMIT_FOR_REVIEW";
  input: SubmitForReviewInput;
};
export type ApproveNoteAction = Action & {
  type: "APPROVE_NOTE";
  input: ApproveNoteInput;
};
export type RejectNoteAction = Action & {
  type: "REJECT_NOTE";
  input: RejectNoteInput;
};
export type ArchiveNoteAction = Action & {
  type: "ARCHIVE_NOTE";
  input: ArchiveNoteInput;
};
export type RestoreNoteAction = Action & {
  type: "RESTORE_NOTE";
  input: RestoreNoteInput;
};

export type KnowledgeNoteLifecycleAction =
  | SubmitForReviewAction
  | ApproveNoteAction
  | RejectNoteAction
  | ArchiveNoteAction
  | RestoreNoteAction;
