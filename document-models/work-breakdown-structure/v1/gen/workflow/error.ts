export type ErrorCode =
  | "GoalNotFoundError"
  | "MissingBlockReasonError"
  | "DependencyNotFoundError"
  | "InvalidDependencyError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class GoalNotFoundError extends Error implements ReducerError {
  errorCode = "GoalNotFoundError" as ErrorCode;
  constructor(message = "GoalNotFoundError") {
    super(message);
  }
}

export class MissingBlockReasonError extends Error implements ReducerError {
  errorCode = "MissingBlockReasonError" as ErrorCode;
  constructor(message = "MissingBlockReasonError") {
    super(message);
  }
}

export class DependencyNotFoundError extends Error implements ReducerError {
  errorCode = "DependencyNotFoundError" as ErrorCode;
  constructor(message = "DependencyNotFoundError") {
    super(message);
  }
}

export class InvalidDependencyError extends Error implements ReducerError {
  errorCode = "InvalidDependencyError" as ErrorCode;
  constructor(message = "InvalidDependencyError") {
    super(message);
  }
}

export const errors = {
  SetGoalStatus: { GoalNotFoundError, MissingBlockReasonError },

  AssignGoal: { GoalNotFoundError },

  SetOutcome: { GoalNotFoundError },

  AddDependencies: {
    GoalNotFoundError,
    DependencyNotFoundError,
    InvalidDependencyError,
  },

  RemoveDependencies: { GoalNotFoundError },
};
