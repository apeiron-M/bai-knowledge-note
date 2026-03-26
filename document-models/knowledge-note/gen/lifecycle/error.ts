export type ErrorCode = "InvalidStatusTransitionError" | "SelfApprovalError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class InvalidStatusTransitionError
  extends Error
  implements ReducerError
{
  errorCode = "InvalidStatusTransitionError" as ErrorCode;
  constructor(message = "InvalidStatusTransitionError") {
    super(message);
  }
}

export class SelfApprovalError extends Error implements ReducerError {
  errorCode = "SelfApprovalError" as ErrorCode;
  constructor(message = "SelfApprovalError") {
    super(message);
  }
}

export const errors = {
  SubmitForReview: { InvalidStatusTransitionError },
  ApproveNote: { InvalidStatusTransitionError, SelfApprovalError },
  RejectNote: { InvalidStatusTransitionError },
  ArchiveNote: { InvalidStatusTransitionError },
  RestoreNote: { InvalidStatusTransitionError },
};
