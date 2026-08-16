export type ErrorCode =
  | "DuplicateGoalIdError"
  | "GoalNotFoundError"
  | "InvalidParentError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class DuplicateGoalIdError extends Error implements ReducerError {
  errorCode = "DuplicateGoalIdError" as ErrorCode;
  constructor(message = "DuplicateGoalIdError") {
    super(message);
  }
}

export class GoalNotFoundError extends Error implements ReducerError {
  errorCode = "GoalNotFoundError" as ErrorCode;
  constructor(message = "GoalNotFoundError") {
    super(message);
  }
}

export class InvalidParentError extends Error implements ReducerError {
  errorCode = "InvalidParentError" as ErrorCode;
  constructor(message = "InvalidParentError") {
    super(message);
  }
}

export const errors = {
  CreateGoal: { DuplicateGoalIdError, GoalNotFoundError },

  UpdateGoalDescription: { GoalNotFoundError },

  DeleteGoal: { GoalNotFoundError },

  Reorder: { GoalNotFoundError, InvalidParentError },
};
