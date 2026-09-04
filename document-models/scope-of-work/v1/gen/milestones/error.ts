export type ErrorCode =
  | "MilestoneAlreadyExistsError"
  | "MilestoneDeliverableAlreadyExistsError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class MilestoneAlreadyExistsError extends Error implements ReducerError {
  errorCode = "MilestoneAlreadyExistsError" as ErrorCode;
  constructor(message = "MilestoneAlreadyExistsError") {
    super(message);
  }
}

export class MilestoneDeliverableAlreadyExistsError
  extends Error
  implements ReducerError
{
  errorCode = "MilestoneDeliverableAlreadyExistsError" as ErrorCode;
  constructor(message = "MilestoneDeliverableAlreadyExistsError") {
    super(message);
  }
}

export const errors = {
  AddMilestone: { MilestoneAlreadyExistsError },

  AddMilestoneDeliverable: { MilestoneDeliverableAlreadyExistsError },
};
