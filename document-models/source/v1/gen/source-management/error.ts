export type ErrorCode = "ClaimNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class ClaimNotFoundError extends Error implements ReducerError {
  errorCode = "ClaimNotFoundError" as ErrorCode;
  constructor(message = "ClaimNotFoundError") {
    super(message);
  }
}

export const errors = {
  RemoveExtractedClaim: { ClaimNotFoundError },
};
