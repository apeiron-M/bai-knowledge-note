import type { Action } from "document-model";
import type { CatalogEntry, CatalogField } from "./op-catalog.js";

export interface EnvelopeContext {
  generateId: () => string;
  /** ISO-8601 timestamp, e.g. `() => new Date().toISOString()`. */
  now: () => string;
  actor?: string;
  /** App-known values for ref-id fields, keyed by dotted path. */
  refIds?: Record<string, string | string[]>;
}

export type BuildActionResult =
  | { ok: true; action: Action; input: Record<string, unknown> }
  | { ok: false; error: string; input: Record<string, unknown> };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fill(
  fields: CatalogField[],
  target: Record<string, unknown>,
  ctx: EnvelopeContext,
): void {
  for (const f of fields) {
    if (f.children) {
      const current = target[f.name];
      const obj = isRecord(current) ? current : f.required ? {} : undefined;
      if (obj) {
        fill(f.children, obj, ctx);
        target[f.name] = obj;
      }
      continue;
    }
    switch (f.fieldClass) {
      case "new-id":
        target[f.name] = ctx.generateId();
        break;
      case "timestamp":
        target[f.name] = ctx.now();
        break;
      case "actor":
        if (ctx.actor) target[f.name] = ctx.actor;
        break;
      case "ref-id": {
        const known = ctx.refIds?.[f.path.join(".")];
        if (target[f.name] === undefined && known !== undefined) {
          target[f.name] = known;
        }
        break;
      }
      case "semantic":
        break;
    }
  }
}

/**
 * Merge model-produced semantic args with app-supplied ids, timestamps and
 * actor, then build the action through the generated (zod-validating)
 * creator. A zod failure is returned, not thrown.
 */
export function buildAction(
  entry: Pick<CatalogEntry, "fields" | "creator">,
  args: Record<string, unknown>,
  ctx: EnvelopeContext,
): BuildActionResult {
  const input = structuredClone(args);
  fill(entry.fields, input, ctx);
  try {
    return { ok: true, action: entry.creator(input), input };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : JSON.stringify(err),
      input,
    };
  }
}
