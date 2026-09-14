import type { ModelRule } from "../types.js";

export const pipelineQueueRules: ModelRule[] = [
  (a, i) =>
    a.type === "ADD_TASK" &&
    typeof a.input.taskType === "string" &&
    a.input.taskType !== "claim" &&
    a.input.taskType !== "enrichment"
      ? [
          {
            path: `actions[${i}].input.taskType`,
            rule: "TASK_TYPE_CONVENTION",
            class: "VAULT_CONVENTION",
            message: "taskType must be claim or enrichment",
          },
        ]
      : [],
];