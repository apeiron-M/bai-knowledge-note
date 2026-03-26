export type ErrorCode = "DuplicateNodeError" | "NodeNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class DuplicateNodeError extends Error implements ReducerError {
  errorCode = "DuplicateNodeError" as ErrorCode;
  constructor(message = "DuplicateNodeError") {
    super(message);
  }
}

export class NodeNotFoundError extends Error implements ReducerError {
  errorCode = "NodeNotFoundError" as ErrorCode;
  constructor(message = "NodeNotFoundError") {
    super(message);
  }
}

export const errors = {
  AddNode: { DuplicateNodeError },
  RemoveNode: { NodeNotFoundError },
  UpdateNode: { NodeNotFoundError },
};
