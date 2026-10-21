/**
 * The one place that decides what a training row looks like, in prompt
 * format r6.1. Every prompt byte comes from the chat core's own builders
 * as the v1 runtime uses them: step 1 is the `ops` scoring prompt over the
 * scoped model's ops (the base-model runtime skips it for gte-small top-1;
 * a LoRA is trained on it), step 2 is `prepareArgsStep` with the v1 gate.
 * `tests/unit/training-prompt-format.test.ts` pins the bytes.
 */
import {
  prepareArgsStep,
  preparedGrammar,
  type PreparedArgsStep,
} from "../../editors/knowledge-vault/chat/core/args-step.js";
import type { RefCandidate } from "../../editors/knowledge-vault/chat/core/args-grammar.js";
import { buildRuntimeCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import type {
  CatalogEntry,
  JsonSchema,
} from "../../editors/knowledge-vault/chat/core/op-catalog.js";
import {
  createOpEmbeddingIndex,
  loadOpEmbeddingAsset,
} from "../../editors/knowledge-vault/chat/core/op-embedding-index.js";
import {
  forcedOpsText,
  gbnfLiteral,
  scoringMessages,
  toOptions,
} from "../../editors/knowledge-vault/chat/core/op-scorer.js";
import { V1_ARGS } from "../../editors/knowledge-vault/chat/core/v1-pipeline.js";
import type { WllamaChatMessage } from "../../editors/knowledge-vault/chat/core/wllama-types.js";

export { PROMPT_FORMAT_VERSION } from "../../editors/knowledge-vault/chat/core/prompt-format.js";

/** Unscoped step-1 candidates: gte-small's top k (round 6 U-config). */
export const UNSCOPED_K = 5;

export function buildTrainingCatalog(): CatalogEntry[] {
  return buildRuntimeCatalog();
}

export interface StepPrompt {
  messages: WllamaChatMessage[];
  /** GBNF the target must be derivable from (checked by the renderer). */
  grammar: string;
  /** Step 2: the gated, ordered schema the grammar is built from. */
  schema: JsonSchema | null;
}

/** Every global op of the row's model, in catalog order. */
export function scopedCandidates(
  catalog: CatalogEntry[],
  docType: string,
): CatalogEntry[] {
  return catalog.filter((e) => e.docType === docType && e.scope === "global");
}

let index: Promise<{
  rank: (q: Float32Array, docType?: string) => CatalogEntry[];
  embed: (t: string) => Promise<Float32Array>;
}> | null = null;

/**
 * gte-small ranking on the browser's wasm numerics
 * (`scripts/gte-wasm-node.ts`) and the committed op vectors, so the
 * candidates are the ones the app would retrieve. Loaded on first use.
 */
async function embeddingRank(
  catalog: CatalogEntry[],
  utterance: string,
  docType?: string,
): Promise<CatalogEntry[]> {
  index ??= (async () => {
    const { loadNodeWasmEmbedder } =
      await import("../../scripts/gte-wasm-node.js");
    const emb = await loadNodeWasmEmbedder();
    const asset = await loadOpEmbeddingAsset();
    const idx = createOpEmbeddingIndex(catalog, asset);
    return {
      rank: (q, d) => idx.rankOps(q, d).map((h) => h.entry),
      embed: async (t) => (await emb.embed([t]))[0],
    };
  })();
  const { rank, embed } = await index;
  return rank(await embed(utterance), docType);
}

/** gte-small's top `UNSCOPED_K` over all global ops. */
export async function unscopedCandidates(
  catalog: CatalogEntry[],
  utterance: string,
): Promise<CatalogEntry[]> {
  return (await embeddingRank(catalog, utterance)).slice(0, UNSCOPED_K);
}

/**
 * gte-small's top `k` among the scoped model's global ops, best first: the
 * step-1 list a LoRA picks from at run time (round 8 C2/C3), the same
 * ranking `runV1` takes its top-1 from.
 */
export async function scopedTopK(
  catalog: CatalogEntry[],
  utterance: string,
  docType: string,
  k: number,
): Promise<CatalogEntry[]> {
  return (await embeddingRank(catalog, utterance, docType)).slice(0, k);
}

export function step1Prompt(
  utterance: string,
  candidates: CatalogEntry[],
): StepPrompt {
  const answers = [...candidates.map((c) => [c.key]), []].map((k) =>
    gbnfLiteral(forcedOpsText(k)),
  );
  return {
    messages: scoringMessages(utterance, toOptions(candidates, "key"), "ops"),
    grammar: `root ::= ${answers.join(" | ")}`,
    schema: null,
  };
}

/**
 * Step-1 target: the gold op, `{"ops": []}` for no action, or null when the
 * gold op is not among the (unscoped) candidates.
 */
export function step1Target(
  goldKey: string | null,
  candidates: CatalogEntry[],
): string | null {
  if (!goldKey) return forcedOpsText([]);
  return candidates.some((c) => c.key === goldKey)
    ? forcedOpsText([goldKey])
    : null;
}

/** Source-row refs: ids only (labels default to the id) or `{id, label}`. */
export type RowRefs = Record<
  string,
  (string | { id: string; label?: string })[]
>;

export function toRefCandidates(
  refs: RowRefs | undefined,
): Record<string, { id: string; label?: string }[]> {
  return Object.fromEntries(
    Object.entries(refs ?? {}).map(([p, cs]) => [
      p,
      cs.map((c) => (typeof c === "string" ? { id: c } : c)),
    ]),
  );
}

export interface Step2 extends StepPrompt {
  prepared: PreparedArgsStep;
}

/** Step-2 prompt, or null when the gated op has no field (no step 2). */
export function step2Prompt(
  utterance: string,
  entry: CatalogEntry,
  refs?: RowRefs,
): Step2 | null {
  const prepared = prepareArgsStep(
    utterance,
    entry,
    toRefCandidates(refs),
    V1_ARGS.gate,
  );
  if (!prepared.messages) return null;
  return {
    messages: prepared.messages,
    grammar: preparedGrammar(prepared, utterance),
    schema: prepared.ordered,
    prepared,
  };
}

/** Ref ids in `args` replaced by their labels (the model's vocabulary). */
function idsToLabels(
  args: Record<string, unknown>,
  labeled: Record<string, RefCandidate[]>,
): Record<string, unknown> {
  const out = structuredClone(args);
  for (const [path, cands] of Object.entries(labeled)) {
    const keys = path.split(".");
    let parent: Record<string, unknown> | null = out;
    for (const k of keys.slice(0, -1)) {
      const next: unknown = parent[k];
      parent = isRecord(next) ? next : null;
      if (!parent) break;
    }
    const leaf = keys[keys.length - 1];
    if (!parent || !(leaf in parent)) continue;
    const toLabel = (v: unknown) => cands.find((c) => c.id === v)?.label ?? v;
    const cur = parent[leaf];
    parent[leaf] = Array.isArray(cur) ? cur.map(toLabel) : toLabel(cur);
  }
  return out;
}

/** Root keys in the step-2 order, nested objects as the grammar orders them. */
export function step2Target(s: Step2, args: Record<string, unknown>): string {
  const labeled = idsToLabels(args, s.prepared.labeled);
  const props = isRecord(s.prepared.ordered.properties)
    ? s.prepared.ordered.properties
    : {};
  const order = [
    ...s.prepared.order,
    ...Object.keys(labeled).filter((k) => !s.prepared.order.includes(k)),
  ].filter((k) => labeled[k] !== undefined);
  const parts = order.map(
    (k) => `${JSON.stringify(k)}: ${canonicalJson(labeled[k], props[k])}`,
  );
  return `{${parts.join(", ")}}`;
}

/* ------------------------------------------------------------------ */
/* Compact JSON in the order the args grammar emits                     */
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
 * `{"k": v, "k2": v2}` with `", "` / `": "` separators. Nested object keys
 * follow `argsGrammar`: required properties first, then optional ones,
 * each group in `properties` order. The renderer re-checks every target
 * against the runtime grammar.
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
