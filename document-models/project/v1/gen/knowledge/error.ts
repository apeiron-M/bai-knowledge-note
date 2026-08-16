export type ErrorCode =
  | "DuplicateKnowledgeRefError"
  | "KnowledgeRefNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class DuplicateKnowledgeRefError extends Error implements ReducerError {
  errorCode = "DuplicateKnowledgeRefError" as ErrorCode;
  constructor(message = "DuplicateKnowledgeRefError") {
    super(message);
  }
}

export class KnowledgeRefNotFoundError extends Error implements ReducerError {
  errorCode = "KnowledgeRefNotFoundError" as ErrorCode;
  constructor(message = "KnowledgeRefNotFoundError") {
    super(message);
  }
}

export const errors = {
  AddKnowledgeRef: { DuplicateKnowledgeRefError },

  RemoveKnowledgeRef: { KnowledgeRefNotFoundError },
};
