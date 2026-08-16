import type { WorkBreakdownStructureDocumentationOperations } from "document-models/work-breakdown-structure/v1";
import {
  DuplicateNoteIdError,
  GoalNotFoundError,
  NoteNotFoundError,
} from "../../gen/documentation/error.js";

export const workBreakdownStructureDocumentationOperations: WorkBreakdownStructureDocumentationOperations =
  {
    addNoteOperation(state, action) {
      const g = state.goals.find((g) => g.id === action.input.goalId);
      if (!g) throw new GoalNotFoundError("Goal not found");
      if (g.notes.some((n) => n.id === action.input.noteId))
        throw new DuplicateNoteIdError("Note id already exists");
      g.notes.push({
        id: action.input.noteId,
        note: action.input.note,
        author: action.input.author || null,
        timestamp: action.input.timestamp || null,
      });
    },
    removeNoteOperation(state, action) {
      const g = state.goals.find((g) => g.id === action.input.goalId);
      if (!g) throw new GoalNotFoundError("Goal not found");
      const i = g.notes.findIndex((n) => n.id === action.input.noteId);
      if (i === -1) throw new NoteNotFoundError("Note not found");
      g.notes.splice(i, 1);
    },
    setOwnerOperation(state, action) {
      state.owner = action.input.owner || null;
    },
    setReferencesOperation(state, action) {
      state.references = action.input.references;
    },
    setProjectRefOperation(state, action) {
      state.projectRef = action.input.projectRef || null;
    },
  };
