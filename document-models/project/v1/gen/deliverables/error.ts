export type ErrorCode =
  | "DuplicateDeliverableError"
  | "DeliverableNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class DuplicateDeliverableError extends Error implements ReducerError {
  errorCode = "DuplicateDeliverableError" as ErrorCode;
  constructor(message = "DuplicateDeliverableError") {
    super(message);
  }
}

export class DeliverableNotFoundError extends Error implements ReducerError {
  errorCode = "DeliverableNotFoundError" as ErrorCode;
  constructor(message = "DeliverableNotFoundError") {
    super(message);
  }
}

export const errors = {
  AddDeliverable: { DuplicateDeliverableError },

  UpdateDeliverable: { DeliverableNotFoundError },

  SetDeliverableStatus: { DeliverableNotFoundError },

  RemoveDeliverable: { DeliverableNotFoundError },
};
