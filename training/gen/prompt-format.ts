/**
 * The one place that decides what a training row looks like; every prompt
 * byte comes from the chat core's builders. Mirrors the shipped path
 * (`use-chat-llm.ts` -> `generateAction`): default catalog, scoped BM25 k=5,
 * `selectOpMessages` + `{"op": enum}`, then `fillArgsMessages`.
 * When round 6 lands its final format, change only this file, bump
 * PROMPT_FORMAT_VERSION and re-run `training/scripts/render.sh`.
 */
import { buildVaultCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import {
  fillArgsMessages,
  opEnumSchema,
  selectOpMessages,
} from "../../editors/knowledge-vault/chat/core/generator.js";
import {
  buildModelSchema,
  type CatalogEntry,
  type JsonSchema,
} from "../../editors/knowledge-vault/chat/core/op-catalog.js";
import type { WllamaChatMessage } from "../../editors/knowledge-vault/chat/core/wllama-types.js";

export const PROMPT_FORMAT_VERSION = "r5-runtime-op-1";

/** Candidates per step-1 prompt, as in `use-chat-llm.ts`. */
export const RETRIEVE_K = 5;

export function buildTrainingCatalog(): CatalogEntry[] {
  return buildVaultCatalog();
}

export interface StepPrompt {
  messages: WllamaChatMessage[];
  /** The response_format json_schema the runtime constrains this step with. */
  schema: JsonSchema;
}

export function step1Prompt(
  utterance: string,
  candidates: CatalogEntry[],
): StepPrompt {
  return {
    messages: selectOpMessages(utterance, candidates),
    schema: opEnumSchema(candidates.map((c) => c.key)),
  };
}

/**
 * Step-1 target, or null when the current format cannot express the label
 * (no gold op, or gold not among the candidates). Round 6 decides how
 * no-action is written; until then such rows are skipped.
 */
export function step1Target(
  goldKey: string | null,
  candidates: CatalogEntry[],
): string | null {
  if (!goldKey || !candidates.some((c) => c.key === goldKey)) return null;
  return canonicalJson({ op: goldKey }, opEnumSchema([goldKey]));
}

/** Step-2 prompt, or null when the op has no semantic fields (no step 2). */
export function step2Prompt(
  utterance: string,
  entry: CatalogEntry,
  refCandidates?: Record<string, string[]>,
): StepPrompt | null {
  const schema = buildModelSchema(entry, { refCandidates });
  const props = schema.properties;
  if (!isRecord(props) || Object.keys(props).length === 0) return null;
  return { messages: fillArgsMessages(utterance, entry, schema), schema };
}

export function step2Target(
  schema: JsonSchema,
  args: Record<string, unknown>,
): string {
  return canonicalJson(args, schema);
}

/* ------------------------------------------------------------------ */
/* Canonical JSON in the order llama.cpp's json-schema grammar emits     */
/* ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The non-null branch of `anyOf: [X, {type: "null"}]`, else the schema. */
function nonNullBranch(schema: unknown): unknown {
  if (!isRecord(schema) || !Array.isArray(schema.anyOf)) return schema;
  const branches: unknown[] = schema.anyOf;
  const rest = branches.filter((b) => !(isRecord(b) && b.type === "null"));
  return rest.length === 1 ? rest[0] : schema;
}

/**
 * `{"k": v, "k2": v2}` with `", "` / `": "` separators and no outer space.
 * Object keys follow `common/json-schema-to-grammar.cpp`: required
 * properties first, then optional ones, each group in `properties` order.
 * The renderer re-checks every target against the server's grammar.
 */
export function canonicalJson(value: unknown, schema?: unknown): string {
  const s = nonNullBranch(schema);
  if (Array.isArray(value)) {
    const items = isRecord(s) ? s.items : undefined;
    return `[${value.map((v) => canonicalJson(v, items)).join(", ")}]`;
  }
  if (isRecord(value)) {
    const props = isRecord(s) && isRecord(s.properties) ? s.properties : {};
    const required = new Set(
      isRecord(s) && Array.isArray(s.required) ? s.required : [],
    );
    const known = Object.keys(props);
    const order = [
      ...known.filter((k) => required.has(k)),
      ...known.filter((k) => !required.has(k)),
      ...Object.keys(value).filter((k) => !known.includes(k)),
    ].filter((k) => value[k] !== undefined);
    const parts = order.map(
      (k) => `${JSON.stringify(k)}: ${canonicalJson(value[k], props[k])}`,
    );
    return `{${parts.join(", ")}}`;
  }
  return JSON.stringify(value);
}
