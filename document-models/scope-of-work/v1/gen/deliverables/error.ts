export type ErrorCode =
  | "DeliverableAlreadyExistsError"
  | "InvalidProgressError"
  | "DeliverableClosedError"
  | "KeyResultAlreadyExistsError"
  | "InvalidBudgetAnchorError"
  | "DeliverableNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class DeliverableAlreadyExistsError
  extends Error
  implements ReducerError
{
  errorCode = "DeliverableAlreadyExistsError" as ErrorCode;
  constructor(message = "DeliverableAlreadyExistsError") {
    super(message);
  }
}

export class InvalidProgressError extends Error implements ReducerError {
  errorCode = "InvalidProgressError" as ErrorCode;
  constructor(message = "InvalidProgressError") {
    super(message);
  }
}

export class DeliverableClosedError extends Error implements ReducerError {
  errorCode = "DeliverableClosedError" as ErrorCode;
  constructor(message = "DeliverableClosedError") {
    super(message);
  }
}

export class KeyResultAlreadyExistsError extends Error implements ReducerError {
  errorCode = "KeyResultAlreadyExistsError" as ErrorCode;
  constructor(message = "KeyResultAlreadyExistsError") {
    super(message);
  }
}

export class InvalidBudgetAnchorError extends Error implements ReducerError {
  errorCode = "InvalidBudgetAnchorError" as ErrorCode;
  constructor(message = "InvalidBudgetAnchorError") {
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
  AddDeliverable: { DeliverableAlreadyExistsError },

  SetDeliverableProgress: { InvalidProgressError, DeliverableClosedError },

  AddKeyResult: { KeyResultAlreadyExistsError },

  SetDeliverableBudgetAnchorProject: { InvalidBudgetAnchorError },

  LinkDeliverableGoal: { DeliverableNotFoundError },
};
