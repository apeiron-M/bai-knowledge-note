export type ErrorCode = "TaskNotFoundError" | "InvalidTaskStatusError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class TaskNotFoundError extends Error implements ReducerError {
  errorCode = "TaskNotFoundError" as ErrorCode;
  constructor(message = "TaskNotFoundError") {
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
  AssignTask: { TaskNotFoundError },
  AdvancePhase: { TaskNotFoundError },
  CompleteTask: { TaskNotFoundError },
  FailTask: { TaskNotFoundError },
  BlockTask: { TaskNotFoundError },
  UnblockTask: { TaskNotFoundError, InvalidTaskStatusError },
};
