export type ErrorCode = "AgentAlreadyExistsError" | "AgentNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class AgentAlreadyExistsError extends Error implements ReducerError {
  errorCode = "AgentAlreadyExistsError" as ErrorCode;
  constructor(message = "AgentAlreadyExistsError") {
    super(message);
  }
}

export class AgentNotFoundError extends Error implements ReducerError {
  errorCode = "AgentNotFoundError" as ErrorCode;
  constructor(message = "AgentNotFoundError") {
    super(message);
  }
}

export const errors = {
  AddAgent: { AgentAlreadyExistsError },

  RemoveAgent: { AgentNotFoundError },
};
