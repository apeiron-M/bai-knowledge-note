export type ErrorCode = "DuplicateMemberError" | "MemberNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class DuplicateMemberError extends Error implements ReducerError {
  errorCode = "DuplicateMemberError" as ErrorCode;
  constructor(message = "DuplicateMemberError") {
    super(message);
  }
}

export class MemberNotFoundError extends Error implements ReducerError {
  errorCode = "MemberNotFoundError" as ErrorCode;
  constructor(message = "MemberNotFoundError") {
    super(message);
  }
}

export const errors = {
  AddMember: { DuplicateMemberError },

  UpdateMember: { MemberNotFoundError },

  RemoveMember: { MemberNotFoundError },
};
