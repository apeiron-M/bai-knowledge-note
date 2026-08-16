export type ErrorCode = "AlreadyInitializedError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class AlreadyInitializedError extends Error implements ReducerError {
  errorCode = "AlreadyInitializedError" as ErrorCode;
  constructor(message = "AlreadyInitializedError") {
    super(message);
  }
}

export const errors = {
  CreateProject: { AlreadyInitializedError },
};
