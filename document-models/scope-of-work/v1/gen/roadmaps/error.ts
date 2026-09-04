export type ErrorCode = "RoadmapAlreadyExistsError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class RoadmapAlreadyExistsError extends Error implements ReducerError {
  errorCode = "RoadmapAlreadyExistsError" as ErrorCode;
  constructor(message = "RoadmapAlreadyExistsError") {
    super(message);
  }
}

export const errors = {
  AddRoadmap: { RoadmapAlreadyExistsError },
};
