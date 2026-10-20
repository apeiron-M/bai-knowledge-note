import type { Progress } from "../../gen/schema/types.js";

/**
 * `Progress` is a flat record where exactly one representation is populated.
 * These constructors are the only way reducers should build one, so every
 * value carries all four keys and the unused ones are explicitly null.
 */
export const percentageProgress = (value: number): Progress => ({
  value,
  total: null,
  completed: null,
  done: null,
});

export const storyPointsProgress = (
  total: number,
  completed: number,
): Progress => ({
  value: null,
  total,
  completed,
  done: null,
});

export const binaryProgress = (done: boolean): Progress => ({
  value: null,
  total: null,
  completed: null,
  done,
});
