export type ErrorCode =
  | "GoalNotFoundError"
  | "DuplicateNoteIdError"
  | "NoteNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class GoalNotFoundError extends Error implements ReducerError {
  errorCode = "GoalNotFoundError" as ErrorCode;
  constructor(message = "GoalNotFoundError") {
    super(message);
  }
}

export class DuplicateNoteIdError extends Error implements ReducerError {
  errorCode = "DuplicateNoteIdError" as ErrorCode;
  constructor(message = "DuplicateNoteIdError") {
    super(message);
  }
}

export class NoteNotFoundError extends Error implements ReducerError {
  errorCode = "NoteNotFoundError" as ErrorCode;
  constructor(message = "NoteNotFoundError") {
    super(message);
  }
}

export const errors = {
  AddNote: { GoalNotFoundError, DuplicateNoteIdError },

  RemoveNote: { GoalNotFoundError, NoteNotFoundError },
};
