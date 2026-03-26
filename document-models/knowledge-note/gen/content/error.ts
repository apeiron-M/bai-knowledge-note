export type ErrorCode =
  | "DescriptionTooLongError"
  | "PatchOutOfBoundsError"
  | "InvalidMetadataFieldError"
  | "InvalidMetadataListFieldError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class DescriptionTooLongError extends Error implements ReducerError {
  errorCode = "DescriptionTooLongError" as ErrorCode;
  constructor(message = "DescriptionTooLongError") {
    super(message);
  }
}

export class PatchOutOfBoundsError extends Error implements ReducerError {
  errorCode = "PatchOutOfBoundsError" as ErrorCode;
  constructor(message = "PatchOutOfBoundsError") {
    super(message);
  }
}

export class InvalidMetadataFieldError extends Error implements ReducerError {
  errorCode = "InvalidMetadataFieldError" as ErrorCode;
  constructor(message = "InvalidMetadataFieldError") {
    super(message);
  }
}

export class InvalidMetadataListFieldError
  extends Error
  implements ReducerError
{
  errorCode = "InvalidMetadataListFieldError" as ErrorCode;
  constructor(message = "InvalidMetadataListFieldError") {
    super(message);
  }
}

export const errors = {
  SetDescription: { DescriptionTooLongError },
  PatchContent: { PatchOutOfBoundsError },
  SetMetadataField: { InvalidMetadataFieldError },
  SetMetadataListField: { InvalidMetadataListFieldError },
};
