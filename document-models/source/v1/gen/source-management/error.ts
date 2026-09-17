export type ErrorCode =
  | "InvalidSourceStatusTransitionError"
  | "InvalidExtractionStatsError"
  | "ExtractionStatsMismatchError"
  | "ClaimNotFoundError"
  | "OriginalAlreadyAttachedError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class InvalidSourceStatusTransitionError
  extends Error
  implements ReducerError
{
  errorCode = "InvalidSourceStatusTransitionError" as ErrorCode;
  constructor(message = "InvalidSourceStatusTransitionError") {
    super(message);
  }
}

export class InvalidExtractionStatsError extends Error implements ReducerError {
  errorCode = "InvalidExtractionStatsError" as ErrorCode;
  constructor(message = "InvalidExtractionStatsError") {
    super(message);
  }
}

export class ExtractionStatsMismatchError
  extends Error
  implements ReducerError
{
  errorCode = "ExtractionStatsMismatchError" as ErrorCode;
  constructor(message = "ExtractionStatsMismatchError") {
    super(message);
  }
}

export class ClaimNotFoundError extends Error implements ReducerError {
  errorCode = "ClaimNotFoundError" as ErrorCode;
  constructor(message = "ClaimNotFoundError") {
    super(message);
  }
}

export class OriginalAlreadyAttachedError
  extends Error
  implements ReducerError
{
  errorCode = "OriginalAlreadyAttachedError" as ErrorCode;
  constructor(message = "OriginalAlreadyAttachedError") {
    super(message);
  }
}

export const errors = {
  SetSourceStatus: { InvalidSourceStatusTransitionError },

  RecordExtractionStats: {
    InvalidExtractionStatsError,
    ExtractionStatsMismatchError,
  },

  RemoveExtractedClaim: { ClaimNotFoundError },

  AttachOriginalFile: { OriginalAlreadyAttachedError },
};
