import type { LintFinding } from "./lint/types.js";
import { HttpError } from "./respond.js";

/**
 * Request-shape validation, applied before anything is dispatched.
 *
 * The principle: **an invalid call is refused with a precise error, never
 * half-accepted and never silently reinterpreted.** Two failure modes this
 * closes, both of which used to be documented as things the caller had to
 * remember rather than things the API enforced:
 *
 *  - a malformed or duplicated action `id`. Duplicate ids are the one that
 *    actually corrupts sync, and the envelope stamper only fills a MISSING id,
 *    so a bad one supplied by the caller went straight to the reactor.
 *  - a misspelt optional field. `{"queu": false}` on `POST sources` used to be
 *    ignored, so the caller believed they had opted out of queueing and had
 *    not. Unknown fields are now an error naming the offending key.
 */

/**
 * An action as it arrives in a request body — every field untrusted and
 * possibly absent. Typing it as the validated `RawAction` would tell the
 * compiler `type` and `input` are always present, which is exactly what this
 * function exists to check.
 */
export interface UntrustedAction {
  id?: unknown;
  timestampUtcMs?: unknown;
  scope?: unknown;
  type?: unknown;
  input?: unknown;
  context?: unknown;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The scopes the reactor recognises. */
export const ACTION_SCOPES = ["global", "local", "document", "auth"] as const;

const isIsoInstant = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
};

/**
 * Rejects a body carrying keys the route does not understand.
 *
 * Silently ignoring an unknown key is the worst option: the request succeeds
 * and does something other than what the caller asked for.
 */
export function rejectUnknownFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
  where = "body",
): void {
  const known = new Set(allowed);
  const unknown = Object.keys(body).filter((key) => !known.has(key));
  if (unknown.length === 0) return;
  throw new HttpError(
    400,
    "UNKNOWN_FIELD",
    `${where} has unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Allowed: ${[...allowed].sort().join(", ")}`,
    unknown.map((key) => ({ path: `${where}.${key}`, rule: "UNKNOWN_FIELD" })),
  );
}

/**
 * Validates the envelope fields a caller MAY supply on an action.
 *
 * Absent values are fine — `stampActions` fills them. This only rejects values
 * that are present and wrong, so that a bad envelope fails as a `400` here
 * rather than a `422` from the reactor after dispatch.
 */
export function validateEnvelopes(
  actions: readonly UntrustedAction[],
): LintFinding[] {
  const findings: LintFinding[] = [];
  const seen = new Map<string, number>();

  actions.forEach((action, index) => {
    const at = `actions[${index}]`;

    if (action.id !== undefined) {
      if (typeof action.id !== "string" || !UUID.test(action.id)) {
        findings.push({
          path: `${at}.id`,
          rule: "INVALID_ACTION_ID",
          class: "REACTOR_REJECTS",
          message: `id must be a UUID; omit it and one is generated for you`,
        });
      } else {
        const first = seen.get(action.id);
        if (first !== undefined) {
          // The corrupting case: two operations sharing an action id.
          findings.push({
            path: `${at}.id`,
            rule: "DUPLICATE_ACTION_ID",
            class: "REACTOR_REJECTS",
            message: `id duplicates actions[${first}].id; every action needs its own`,
          });
        } else {
          seen.set(action.id, index);
        }
      }
    }

    if (
      action.timestampUtcMs !== undefined &&
      (typeof action.timestampUtcMs !== "string" ||
        !isIsoInstant(action.timestampUtcMs))
    ) {
      findings.push({
        path: `${at}.timestampUtcMs`,
        rule: "INVALID_TIMESTAMP",
        class: "REACTOR_REJECTS",
        message: `timestampUtcMs must be an ISO 8601 instant (e.g. 2026-09-14T12:00:00.000Z); omit it and it is set for you`,
      });
    }

    if (
      action.scope !== undefined &&
      !(ACTION_SCOPES as readonly string[]).includes(action.scope as string)
    ) {
      findings.push({
        path: `${at}.scope`,
        rule: "INVALID_SCOPE",
        class: "REACTOR_REJECTS",
        message: `scope must be one of ${ACTION_SCOPES.join(", ")}`,
      });
    }

    if (typeof action.type !== "string" || action.type.length === 0) {
      findings.push({
        path: `${at}.type`,
        rule: "MISSING_ACTION_TYPE",
        class: "REACTOR_REJECTS",
        message: "type is required",
      });
    }
    if (
      action.input === undefined ||
      action.input === null ||
      typeof action.input !== "object" ||
      Array.isArray(action.input)
    ) {
      findings.push({
        path: `${at}.input`,
        rule: "MISSING_ACTION_INPUT",
        class: "REACTOR_REJECTS",
        message: "input must be an object",
      });
    }
  });

  return findings;
}
