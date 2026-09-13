import type { RawAction } from "../envelope.js";
import { hasDocumentType, operationsFor, schemaFor } from "./model-registry.js";
import { RULES } from "./rules.js";
import type { LintFinding, LintOptions } from "./types.js";

const LITERAL_ESCAPE = /\\(n|t|r)/;

/**
 * Reactor base actions the write routes dispatch themselves. They are not
 * operations of any document model, so the model-operation check must not
 * reject them, and the models' zod input schemas do not cover them. The
 * relationships route validates their input and articulation before dispatch.
 */
const BASE_WRITE_ACTIONS = new Set([
  "ADD_RELATIONSHIP",
  "UPDATE_RELATIONSHIP",
  "REMOVE_RELATIONSHIP",
]);

function scanEscapes(
  value: unknown,
  path: string,
  findings: LintFinding[],
): void {
  if (typeof value === "string") {
    if (LITERAL_ESCAPE.test(value)) {
      findings.push({
        path,
        rule: "LITERAL_ESCAPE",
        class: "VAULT_CONVENTION",
        message:
          "string contains a literal \\n/\\t/\\r; send real line breaks or pass allowLiteralEscapes",
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => scanEscapes(item, `${path}[${i}]`, findings));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      scanEscapes(item, `${path}.${key}`, findings);
    }
  }
}

export function lintActions(
  documentType: string,
  state: unknown,
  actions: RawAction[],
  options: LintOptions = {},
): LintFinding[] {
  const findings: LintFinding[] = [];
  if (!hasDocumentType(documentType)) {
    return [
      {
        path: "documentType",
        rule: "UNKNOWN_DOCUMENT_TYPE",
        class: "REACTOR_REJECTS",
        message: `No lint rules registered for ${documentType}`,
      },
    ];
  }
  const operations = operationsFor(documentType) ?? new Set<string>();
  const global =
    (state as { global?: Record<string, unknown> } | undefined)?.global ?? {};

  actions.forEach((action, index) => {
    const base = `actions[${index}]`;
    if (BASE_WRITE_ACTIONS.has(action.type)) return;
    if (!operations.has(action.type)) {
      findings.push({
        path: `${base}.type`,
        rule: "UNKNOWN_ACTION",
        class: "REACTOR_REJECTS",
        message: `${action.type} is not an operation of ${documentType}`,
      });
      return;
    }
    const factory = schemaFor(documentType, action.type);
    if (factory) {
      const parsed = factory().safeParse(action.input);
      if (!parsed.success) {
        for (const issue of parsed.error?.issues ?? []) {
          findings.push({
            path: `${base}.input.${issue.path.join(".")}`.replace(/\.$/, ""),
            rule: "INVALID_INPUT",
            class: "REACTOR_REJECTS",
            message: issue.message,
          });
        }
        return;
      }
    }
    if (!options.allowLiteralEscapes) {
      scanEscapes(action.input, `${base}.input`, findings);
    }
    for (const rule of RULES[documentType] ?? []) {
      findings.push(...rule(action, index, global));
    }
  });

  return findings;
}

export type { LintFinding, LintOptions } from "./types.js";
