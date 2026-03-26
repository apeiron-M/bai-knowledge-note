import { type SignalDispatch } from "document-model";
import type {
  SubmitForReviewAction,
  ApproveNoteAction,
  RejectNoteAction,
  ArchiveNoteAction,
  RestoreNoteAction,
} from "./actions.js";
import type { KnowledgeNoteState } from "../types.js";

export interface KnowledgeNoteLifecycleOperations {
  submitForReviewOperation: (
    state: KnowledgeNoteState,
    action: SubmitForReviewAction,
    dispatch?: SignalDispatch,
  ) => void;
  approveNoteOperation: (
    state: KnowledgeNoteState,
    action: ApproveNoteAction,
    dispatch?: SignalDispatch,
  ) => void;
  rejectNoteOperation: (
    state: KnowledgeNoteState,
    action: RejectNoteAction,
    dispatch?: SignalDispatch,
  ) => void;
  archiveNoteOperation: (
    state: KnowledgeNoteState,
    action: ArchiveNoteAction,
    dispatch?: SignalDispatch,
  ) => void;
  restoreNoteOperation: (
    state: KnowledgeNoteState,
    action: RestoreNoteAction,
    dispatch?: SignalDispatch,
  ) => void;
}
