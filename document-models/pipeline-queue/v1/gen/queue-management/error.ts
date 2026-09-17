export type ErrorCode =
  | "DuplicateTaskIdError"
  | "UnknownTaskTypeError"
  | "InvalidPhaseError"
  | "TaskNotFoundError"
  | "TaskAlreadyAssignedError"
  | "InvalidTaskStatusError"
  | "PhaseMismatchError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class DuplicateTaskIdError extends Error implements ReducerError {
  errorCode = "DuplicateTaskIdError" as ErrorCode;
  constructor(message = "DuplicateTaskIdError") {
    super(message);
  }
}

export class UnknownTaskTypeError extends Error implements ReducerError {
  errorCode = "UnknownTaskTypeError" as ErrorCode;
  constructor(message = "UnknownTaskTypeError") {
    super(message);
  }
}

export class InvalidPhaseError extends Error implements ReducerError {
  errorCode = "InvalidPhaseError" as ErrorCode;
  constructor(message = "InvalidPhaseError") {
    super(message);
  }
}

export class TaskNotFoundError extends Error implements ReducerError {
  errorCode = "TaskNotFoundError" as ErrorCode;
  constructor(message = "TaskNotFoundError") {
    super(message);
  }
}

export class TaskAlreadyAssignedError extends Error implements ReducerError {
  errorCode = "TaskAlreadyAssignedError" as ErrorCode;
  constructor(message = "TaskAlreadyAssignedError") {
    super(message);
  }
}

export class InvalidTaskStatusError extends Error implements ReducerError {
  errorCode = "InvalidTaskStatusError" as ErrorCode;
  constructor(message = "InvalidTaskStatusError") {
    super(message);
  }
}

export class PhaseMismatchError extends Error implements ReducerError {
  errorCode = "PhaseMismatchError" as ErrorCode;
  constructor(message = "PhaseMismatchError") {
    super(message);
  }
}

export const errors = {
  AddTask: { DuplicateTaskIdError, UnknownTaskTypeError, InvalidPhaseError },

  AssignTask: { TaskNotFoundError, TaskAlreadyAssignedError },

  AdvancePhase: {
    TaskNotFoundError,
    InvalidTaskStatusError,
    PhaseMismatchError,
  },

  CompleteTask: { TaskNotFoundError, InvalidTaskStatusError },

  FailTask: { TaskNotFoundError, InvalidTaskStatusError },

  BlockTask: { TaskNotFoundError, InvalidTaskStatusError },

  UnblockTask: { TaskNotFoundError, InvalidTaskStatusError },
};
