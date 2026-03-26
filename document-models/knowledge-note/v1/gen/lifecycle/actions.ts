import type { Action } from "document-model";
import type {
  SubmitForReviewInput,
  ApproveNoteInput,
  RejectNoteInput,
  ArchiveNoteInput,
  RestoreNoteInput,
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
