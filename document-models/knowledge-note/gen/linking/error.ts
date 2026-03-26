export type ErrorCode =
  | "DuplicateLinkIdError"
  | "LinkNotFoundError"
  | "DuplicateTopicError"
  | "TopicNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class DuplicateLinkIdError extends Error implements ReducerError {
  errorCode = "DuplicateLinkIdError" as ErrorCode;
  constructor(message = "DuplicateLinkIdError") {
    super(message);
  }
}

export class LinkNotFoundError extends Error implements ReducerError {
  errorCode = "LinkNotFoundError" as ErrorCode;
  constructor(message = "LinkNotFoundError") {
    super(message);
  }
}

export class DuplicateTopicError extends Error implements ReducerError {
  errorCode = "DuplicateTopicError" as ErrorCode;
  constructor(message = "DuplicateTopicError") {
    super(message);
  }
}

export class TopicNotFoundError extends Error implements ReducerError {
  errorCode = "TopicNotFoundError" as ErrorCode;
  constructor(message = "TopicNotFoundError") {
    super(message);
  }
}

export const errors = {
  AddLink: { DuplicateLinkIdError },
  RemoveLink: { LinkNotFoundError },
  UpdateLinkType: { LinkNotFoundError },
  AddTopic: { DuplicateTopicError },
  RemoveTopic: { TopicNotFoundError },
};
