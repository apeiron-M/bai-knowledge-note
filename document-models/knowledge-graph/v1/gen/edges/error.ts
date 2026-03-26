export type ErrorCode = "DuplicateEdgeError" | "EdgeNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class DuplicateEdgeError extends Error implements ReducerError {
  errorCode = "DuplicateEdgeError" as ErrorCode;
  constructor(message = "DuplicateEdgeError") {
    super(message);
  }
}

export class EdgeNotFoundError extends Error implements ReducerError {
  errorCode = "EdgeNotFoundError" as ErrorCode;
  constructor(message = "EdgeNotFoundError") {
    super(message);
  }
}

export const errors = {
  AddEdge: { DuplicateEdgeError },
  RemoveEdge: { EdgeNotFoundError },
  UpdateEdge: { EdgeNotFoundError },
};
