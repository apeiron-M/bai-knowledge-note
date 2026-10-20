export type ErrorCode =
  | "DuplicateTaskIdError"
  | "TaskNotFoundError"
  | "TaskAlreadyAssignedError"
  | "InvalidTaskStatusError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class DuplicateTaskIdError extends Error implements ReducerError {
  errorCode = "DuplicateTaskIdError" as ErrorCode;
  constructor(message = "DuplicateTaskIdError") {
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

export const errors = {
  AddTask: { DuplicateTaskIdError },

  AssignTask: { TaskNotFoundError, TaskAlreadyAssignedError },

  AdvancePhase: { TaskNotFoundError },

  CompleteTask: { TaskNotFoundError },

  FailTask: { TaskNotFoundError },

  BlockTask: { TaskNotFoundError },

  UnblockTask: { TaskNotFoundError, InvalidTaskStatusError },
};
