export type ErrorCode = "ProvenanceCreatedAtImmutableError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class ProvenanceCreatedAtImmutableError
  extends Error
  implements ReducerError
{
  errorCode = "ProvenanceCreatedAtImmutableError" as ErrorCode;
  constructor(message = "ProvenanceCreatedAtImmutableError") {
    super(message);
  }
}

export const errors = {
  SetProvenance: { ProvenanceCreatedAtImmutableError },
};
