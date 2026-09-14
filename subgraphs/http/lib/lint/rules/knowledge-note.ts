import type { LintFinding, ModelRule } from "../types.js";

const NOTE_TYPES = [
  "concept",
  "decision",
  "pattern",
  "observation",
  "procedure",
  "architecture",
  "bug-pattern",
  "integration",
  "workflow",
  "reference",
];
const METADATA_FIELDS = [
  "scope",
  "confidence",
  "severity",
  "editor",
  "modelId",
  "version",
  "filePath",
  "computes",
  "context",
  "decisionStatus",
  "model",
  "sourceType",
  "targetType",
  "relationType",
  "cardinality",
  "errorMessage",
  "rootCause",
  "correctPattern",
];
const METADATA_LISTS = [
  "models",
  "hooksUsed",
  "dispatchTargets",
  "modules",
  "inputs",
  "outputs",
  "consumedBy",
  "alternatives",
  "consequences",
];
const TRANSITIONS: Record<string, string> = {
  SUBMIT_FOR_REVIEW: "DRAFT",
  APPROVE_NOTE: "IN_REVIEW",
  REJECT_NOTE: "IN_REVIEW",
  ARCHIVE_NOTE: "CANONICAL",
  RESTORE_NOTE: "ARCHIVED",
};

const fail = (
  index: number,
  field: string,
  rule: string,
  message: string,
  cls: LintFinding["class"] = "REACTOR_REJECTS",
): LintFinding => ({
  path: field ? `actions[${index}].input.${field}` : `actions[${index}]`,
  rule,
  class: cls,
  message,
});

export const knowledgeNoteRules: ModelRule[] = [
  (a, i) =>
    a.type === "SET_DESCRIPTION" &&
    typeof a.input.description === "string" &&
    a.input.description.length > 200
      ? [
          fail(
            i,
            "description",
            "DESCRIPTION_TOO_LONG",
            "description exceeds 200 characters",
          ),
        ]
      : [],
  (a, i) =>
    a.type === "SET_METADATA_FIELD" &&
    typeof a.input.field === "string" &&
    !METADATA_FIELDS.includes(a.input.field)
      ? [
          fail(
            i,
            "field",
            "INVALID_METADATA_FIELD",
            `metadata field ${a.input.field} is not allowed`,
          ),
        ]
      : [],
  (a, i) =>
    a.type === "SET_METADATA_LIST_FIELD" &&
    typeof a.input.field === "string" &&
    !METADATA_LISTS.includes(a.input.field)
      ? [
          fail(
            i,
            "field",
            "INVALID_METADATA_LIST_FIELD",
            `metadata list field ${a.input.field} is not allowed`,
          ),
        ]
      : [],
  (a, i) =>
    a.type === "SET_NOTE_TYPE" &&
    typeof a.input.noteType === "string" &&
    !NOTE_TYPES.includes(a.input.noteType)
      ? [
          fail(
            i,
            "noteType",
            "NOTE_TYPE_CONVENTION",
            `noteType must be one of ${NOTE_TYPES.join(", ")}`,
            "VAULT_CONVENTION",
          ),
        ]
      : [],
  (a, i) =>
    a.type === "PATCH_CONTENT" &&
    typeof a.input.offset === "number" &&
    a.input.offset < 0
      ? [fail(i, "offset", "PATCH_OFFSET", "offset must be zero or positive")]
      : [],
  (a, i, state) => {
    const from = TRANSITIONS[a.type];
    const status = typeof state.status === "string" ? state.status : "DRAFT";
    return from && status !== from
      ? [
          fail(
            i,
            "",
            "INVALID_STATUS_TRANSITION",
            `${a.type} requires status ${from}, current is ${status}`,
          ),
        ]
      : [];
  },
  (a, i, state) => {
    const author = (state.provenance as { author?: string } | null | undefined)
      ?.author;
    return a.type === "APPROVE_NOTE" && author && author === a.input.actor
      ? [
          fail(
            i,
            "actor",
            "SELF_APPROVAL",
            "the actor may not approve their own note",
          ),
        ]
      : [];
  },
];