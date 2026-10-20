export type ErrorCode =
  | "ProjectAlreadyExistsError"
  | "InvalidInitialBudgetError"
  | "InvalidBudgetUpdateError"
  | "ProjectNotFoundError"
  | "InvalidProjectMarginError"
  | "InvalidProjectBudgetError"
  | "ProjectDeliverableAlreadyExistsError"
  | "InvalidExpenditureError"
  | "KnowledgeRefAlreadyExistsError"
  | "KnowledgeRefNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class ProjectAlreadyExistsError extends Error implements ReducerError {
  errorCode = "ProjectAlreadyExistsError" as ErrorCode;
  constructor(message = "ProjectAlreadyExistsError") {
    super(message);
  }
}

export class InvalidInitialBudgetError extends Error implements ReducerError {
  errorCode = "InvalidInitialBudgetError" as ErrorCode;
  constructor(message = "InvalidInitialBudgetError") {
    super(message);
  }
}

export class InvalidBudgetUpdateError extends Error implements ReducerError {
  errorCode = "InvalidBudgetUpdateError" as ErrorCode;
  constructor(message = "InvalidBudgetUpdateError") {
    super(message);
  }
}

export class ProjectNotFoundError extends Error implements ReducerError {
  errorCode = "ProjectNotFoundError" as ErrorCode;
  constructor(message = "ProjectNotFoundError") {
    super(message);
  }
}

export class InvalidProjectMarginError extends Error implements ReducerError {
  errorCode = "InvalidProjectMarginError" as ErrorCode;
  constructor(message = "InvalidProjectMarginError") {
    super(message);
  }
}

export class InvalidProjectBudgetError extends Error implements ReducerError {
  errorCode = "InvalidProjectBudgetError" as ErrorCode;
  constructor(message = "InvalidProjectBudgetError") {
    super(message);
  }
}

export class ProjectDeliverableAlreadyExistsError
  extends Error
  implements ReducerError
{
  errorCode = "ProjectDeliverableAlreadyExistsError" as ErrorCode;
  constructor(message = "ProjectDeliverableAlreadyExistsError") {
    super(message);
  }
}

export class InvalidExpenditureError extends Error implements ReducerError {
  errorCode = "InvalidExpenditureError" as ErrorCode;
  constructor(message = "InvalidExpenditureError") {
    super(message);
  }
}

export class KnowledgeRefAlreadyExistsError
  extends Error
  implements ReducerError
{
  errorCode = "KnowledgeRefAlreadyExistsError" as ErrorCode;
  constructor(message = "KnowledgeRefAlreadyExistsError") {
    super(message);
  }
}

export class KnowledgeRefNotFoundError extends Error implements ReducerError {
  errorCode = "KnowledgeRefNotFoundError" as ErrorCode;
  constructor(message = "KnowledgeRefNotFoundError") {
    super(message);
  }
}

export const errors = {
  AddProject: { ProjectAlreadyExistsError, InvalidInitialBudgetError },

  UpdateProject: { InvalidBudgetUpdateError },

  RemoveProject: { ProjectNotFoundError },

  SetProjectMargin: { InvalidProjectMarginError },

  SetProjectTotalBudget: { InvalidProjectBudgetError },

  AddProjectDeliverable: { ProjectDeliverableAlreadyExistsError },

  SetProjectExpenditure: { InvalidExpenditureError },

  AddProjectKnowledgeRef: { KnowledgeRefAlreadyExistsError },

  RemoveProjectKnowledgeRef: { KnowledgeRefNotFoundError },
};
