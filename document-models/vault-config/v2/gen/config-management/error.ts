export type ErrorCode =
  | "InvalidDimensionValueError"
  | "InvalidPipelineConfigError"
  | "InvalidThresholdError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class InvalidDimensionValueError extends Error implements ReducerError {
  errorCode = "InvalidDimensionValueError" as ErrorCode;
  constructor(message = "InvalidDimensionValueError") {
    super(message);
  }
}

export class InvalidPipelineConfigError extends Error implements ReducerError {
  errorCode = "InvalidPipelineConfigError" as ErrorCode;
  constructor(message = "InvalidPipelineConfigError") {
    super(message);
  }
}

export class InvalidThresholdError extends Error implements ReducerError {
  errorCode = "InvalidThresholdError" as ErrorCode;
  constructor(message = "InvalidThresholdError") {
    super(message);
  }
}

export const errors = {
  UpdateDimension: { InvalidDimensionValueError },

  UpdatePipelineConfig: { InvalidPipelineConfigError },

  UpdateMaintenanceThreshold: { InvalidThresholdError },
};
