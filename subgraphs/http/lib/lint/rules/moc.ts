import type { ModelRule } from "../types.js";

export const mocRules: ModelRule[] = [
  (a, i) =>
    a.type === "SET_METADATA_FIELD" &&
    typeof a.input.field === "string" &&
    a.input.field !== "version"
      ? [
          {
            path: `actions[${i}].input.field`,
            rule: "INVALID_METADATA_FIELD",
            class: "REACTOR_REJECTS",
            message: 'moc SET_METADATA_FIELD only accepts "version"',
          },
        ]
      : [],
];