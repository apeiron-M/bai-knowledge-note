export type ErrorCode = "InvalidObservationTransitionError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class InvalidObservationTransitionError
  extends Error
  implements ReducerError
{
  errorCode = "InvalidObservationTransitionError" as ErrorCode;
  constructor(message = "InvalidObservationTransitionError") {
    super(message);
  }
}

export const errors = {
  PromoteObservation: { InvalidObservationTransitionError },

  ImplementObservation: { InvalidObservationTransitionError },

  ArchiveObservation: { InvalidObservationTransitionError },
};
