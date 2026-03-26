export type ErrorCode =
  | "DuplicateCoreIdeaError"
  | "CoreIdeaNotFoundError"
  | "TensionNotFoundError"
  | "DuplicateChildMocError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class DuplicateCoreIdeaError extends Error implements ReducerError {
  errorCode = "DuplicateCoreIdeaError" as ErrorCode;
  constructor(message = "DuplicateCoreIdeaError") {
    super(message);
  }
}

export class CoreIdeaNotFoundError extends Error implements ReducerError {
  errorCode = "CoreIdeaNotFoundError" as ErrorCode;
  constructor(message = "CoreIdeaNotFoundError") {
    super(message);
  }
}

export class TensionNotFoundError extends Error implements ReducerError {
  errorCode = "TensionNotFoundError" as ErrorCode;
  constructor(message = "TensionNotFoundError") {
    super(message);
  }
}

export class DuplicateChildMocError extends Error implements ReducerError {
  errorCode = "DuplicateChildMocError" as ErrorCode;
  constructor(message = "DuplicateChildMocError") {
    super(message);
  }
}

export const errors = {
  AddCoreIdea: { DuplicateCoreIdeaError },
  UpdateCoreIdea: { CoreIdeaNotFoundError },
  RemoveCoreIdea: { CoreIdeaNotFoundError },
  RemoveTension: { TensionNotFoundError },
  AddChildMoc: { DuplicateChildMocError },
};
