export type ErrorCode = "SetDeliverableNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class SetDeliverableNotFoundError extends Error implements ReducerError {
  errorCode = "SetDeliverableNotFoundError" as ErrorCode;
  constructor(message = "SetDeliverableNotFoundError") {
    super(message);
  }
}

export const errors = {
  AddDeliverableInSet: { SetDeliverableNotFoundError },
};
