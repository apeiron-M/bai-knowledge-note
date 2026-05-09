/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { KnowledgeNoteGlobalState } from "../types.js";
import type {
  ApproveNoteAction,
  ArchiveNoteAction,
  RejectNoteAction,
  RestoreNoteAction,
  SubmitForReviewAction,
} from "./actions.js";

export interface KnowledgeNoteLifecycleOperations {
  submitForReviewOperation: (
    state: KnowledgeNoteGlobalState,
    action: SubmitForReviewAction,
    dispatch?: SignalDispatch,
  ) => void;
  approveNoteOperation: (
    state: KnowledgeNoteGlobalState,
    action: ApproveNoteAction,
    dispatch?: SignalDispatch,
  ) => void;
  rejectNoteOperation: (
    state: KnowledgeNoteGlobalState,
    action: RejectNoteAction,
    dispatch?: SignalDispatch,
  ) => void;
  archiveNoteOperation: (
    state: KnowledgeNoteGlobalState,
    action: ArchiveNoteAction,
    dispatch?: SignalDispatch,
  ) => void;
  restoreNoteOperation: (
    state: KnowledgeNoteGlobalState,
    action: RestoreNoteAction,
    dispatch?: SignalDispatch,
  ) => void;
}
