import {
  InvalidStatusTransitionError,
  SelfApprovalError,
} from "../../gen/lifecycle/error.js";
import type { KnowledgeNoteLifecycleOperations } from "knowledge-note/document-models/knowledge-note";

export const knowledgeNoteLifecycleOperations: KnowledgeNoteLifecycleOperations =
  {
    submitForReviewOperation(state, action) {
      if (state.status !== "DRAFT") {
        throw new InvalidStatusTransitionError(
          "Can only submit for review from DRAFT status",
        );
      }
      state.status = "IN_REVIEW";
      state.lifecycleEvents.push({
        id: action.input.id,
        fromStatus: "DRAFT",
        toStatus: "IN_REVIEW",
        actor: action.input.actor,
        timestamp: action.input.timestamp,
        comment: action.input.comment || null,
      });
      if (state.provenance) {
        state.provenance.updatedAt = action.input.timestamp;
      }
    },
    approveNoteOperation(state, action) {
      if (state.status !== "IN_REVIEW") {
        throw new InvalidStatusTransitionError(
          "Can only approve from IN_REVIEW status",
        );
      }
      if (!state.provenance) {
        throw new InvalidStatusTransitionError(
          "Cannot approve a note without provenance",
        );
      }
      if (state.provenance.author === action.input.actor) {
        throw new SelfApprovalError("Actor cannot approve their own note");
      }
      state.status = "CANONICAL";
      state.lifecycleEvents.push({
        id: action.input.id,
        fromStatus: "IN_REVIEW",
        toStatus: "CANONICAL",
        actor: action.input.actor,
        timestamp: action.input.timestamp,
        comment: action.input.comment || null,
      });
      state.provenance.updatedAt = action.input.timestamp;
    },
    rejectNoteOperation(state, action) {
      if (state.status !== "IN_REVIEW") {
        throw new InvalidStatusTransitionError(
          "Can only reject from IN_REVIEW status",
        );
      }
      state.status = "DRAFT";
      state.lifecycleEvents.push({
        id: action.input.id,
        fromStatus: "IN_REVIEW",
        toStatus: "DRAFT",
        actor: action.input.actor,
        timestamp: action.input.timestamp,
        comment: action.input.comment,
      });
      if (state.provenance) {
        state.provenance.updatedAt = action.input.timestamp;
      }
    },
    archiveNoteOperation(state, action) {
      if (state.status !== "CANONICAL") {
        throw new InvalidStatusTransitionError(
          "Can only archive from CANONICAL status",
        );
      }
      state.status = "ARCHIVED";
      state.lifecycleEvents.push({
        id: action.input.id,
        fromStatus: "CANONICAL",
        toStatus: "ARCHIVED",
        actor: action.input.actor,
        timestamp: action.input.timestamp,
        comment: action.input.comment,
      });
      if (state.provenance) {
        state.provenance.updatedAt = action.input.timestamp;
      }
    },
    restoreNoteOperation(state, action) {
      if (state.status !== "ARCHIVED") {
        throw new InvalidStatusTransitionError(
          "Can only restore from ARCHIVED status",
        );
      }
      state.status = "DRAFT";
      state.lifecycleEvents.push({
        id: action.input.id,
        fromStatus: "ARCHIVED",
        toStatus: "DRAFT",
        actor: action.input.actor,
        timestamp: action.input.timestamp,
        comment: action.input.comment || null,
      });
      if (state.provenance) {
        state.provenance.updatedAt = action.input.timestamp;
      }
    },
  };
