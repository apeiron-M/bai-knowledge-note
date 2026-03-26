export type ErrorCode = "TensionAlreadyResolvedError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class TensionAlreadyResolvedError extends Error implements ReducerError {
  errorCode = "TensionAlreadyResolvedError" as ErrorCode;
  constructor(message = "TensionAlreadyResolvedError") {
    super(message);
  }
}

export const errors = {
  ResolveTension: { TensionAlreadyResolvedError },
  DissolveTension: { TensionAlreadyResolvedError },
};
