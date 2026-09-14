import type { ModelRule } from "../types.js";

export const wbsRules: ModelRule[] = [
  (a, i) =>
    a.type === "SET_GOAL_STATUS" &&
    a.input.status === "BLOCKED" &&
    !(typeof a.input.blockReason === "string" && a.input.blockReason.trim())
      ? [
          {
            path: `actions[${i}].input.blockReason`,
            rule: "MISSING_BLOCK_REASON",
            class: "REACTOR_REJECTS",
            message: "BLOCKED requires a non-blank blockReason",
          },
        ]
      : [],
];