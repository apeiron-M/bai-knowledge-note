/**
 * Step 2, round 6 format: the op's semantic fields under a copy-span GBNF,
 * with the document's referenceable items listed by label. A required ref
 * field is emitted first and its label is chosen by calibrated likelihood
 * (each label forced as the `{"<field>": "<label>"` prefix, minus the same
 * prefix under the content-free request); the args are then generated with
 * that label fixed, and the app maps labels back to ids.
 */
import {
  argsGrammar,
  gateOptional,
  labelRefCandidates,
  mapRefLabels,
  refEnumValues,
  requireOneOf,
  type GateMode,
  type RefCandidate,
} from "./args-grammar.js";
import { argsSignature } from "./generator.js";
import type { CompleteJson, ScoreText } from "./llm-client.js";
import {
  buildModelSchema,
  type CatalogEntry,
  type JsonSchema,
} from "./op-catalog.js";
import {
  aggregate,
  argmax,
  CONTENT_FREE,
  gbnfLiteral,
  scoreCacheKey,
  type Aggregate,
  type ScoreCache,
  type ScoredRequest,
} from "./op-scorer.js";
import type { WllamaChatMessage } from "./wllama-types.js";

export const STEP2_SYSTEM =
  "You extract the arguments for a document operation from the user's request. Copy names and text from the request exactly. Answer with JSON.";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Schema copy whose ref fields render as `choice` in the signature. */
function signatureSchema(schema: JsonSchema, refPaths: string[]): JsonSchema {
  const props = isRecord(schema.properties) ? schema.properties : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (refPaths.includes(k)) {
      const list = isRecord(v) && v.type === "array";
      out[k] = list
        ? { type: "array", items: { type: "choice" } }
        : { type: "choice" };
    } else if (isRecord(v) && v.type === "object") {
      const nested = refPaths
        .filter((p) => p.startsWith(`${k}.`))
        .map((p) => p.slice(k.length + 1));
      out[k] = signatureSchema(v, nested);
    } else out[k] = v;
  }
  return { ...schema, properties: out };
}

/**
 * The step-2 prompt. `choices` lists each ref path's labels in document
 * order; ref fields come first in `Arguments` when they are in `first`.
 */
export function argsMessages(
  utterance: string,
  entry: Pick<CatalogEntry, "opName" | "description">,
  schema: JsonSchema,
  choices: Record<string, string[]> = {},
): WllamaChatMessage[] {
  const paths = Object.keys(choices);
  const choiceLines = paths.map(
    (p) =>
      `Choices for ${p}: ${choices[p].map((l) => JSON.stringify(l)).join(", ")}\n`,
  );
  return [
    { role: "system", content: STEP2_SYSTEM },
    {
      role: "user",
      content: `Operation: ${entry.opName} - ${entry.description}\n${choiceLines.join("")}Arguments: ${argsSignature(signatureSchema(schema, paths))}\nRequest: ${utterance}`,
    },
  ];
}

/** Root-level ref paths, in field order, that the step scores first. */
export function scoredRefField(
  schema: JsonSchema,
  refPaths: string[],
): string | null {
  const props = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const k of Object.keys(props)) {
    const v = props[k];
    const scalar = !(isRecord(v) && v.type === "array");
    if (refPaths.includes(k) && required.includes(k) && scalar) return k;
  }
  return null;
}

/** The JSON prefix that fixes a ref label: `{"id": "label"`. */
export function refPrefix(field: string, label: string): string {
  return `{${JSON.stringify(field)}: ${JSON.stringify(label)}`;
}

/**
 * Logprobs of the tokens that cover `prefix` (a token straddling its end,
 * e.g. `",`, counts; the end-of-generation token does not).
 */
export function prefixLogprobs(
  tokens: { token: string; logprob: number }[],
  prefix: string,
): number[] {
  const out: number[] = [];
  let at = 0;
  for (const t of tokens) {
    if (at >= prefix.length) break;
    out.push(t.logprob);
    at += t.token.length;
  }
  return out;
}

export interface ArgsStepOptions {
  completeJson: CompleteJson;
  scoreText: ScoreText;
  gate: GateMode;
  /** Score the first required ref field's labels (else the model picks). */
  scoreRefs: boolean;
  refAggregate?: Aggregate;
  cache?: ScoreCache;
}

export interface ArgsStepResult {
  args: Record<string, unknown> | null;
  raw: string | null;
  error: string | null;
  /** The schema the grammar was built from (after gating). */
  schema: JsonSchema;
  grammar: string | null;
  messages: WllamaChatMessage[] | null;
  refField: string | null;
  refScores: Record<string, number> | null;
  /** Ref-scoring requests made now (utterance pass) and content-free. */
  refMs: number;
  refCfMs: number;
  genMs: number;
  refRequests: ScoredRequest[];
}

/** Ref labels for a path (unique, in order) from labeled candidates. */
function choicesOf(labeled: Record<string, RefCandidate[]>) {
  return Object.fromEntries(
    Object.entries(labeled).map(([p, cs]) => [p, cs.map((c) => c.label)]),
  );
}

export async function fillArgsStep(
  utterance: string,
  entry: CatalogEntry,
  refCandidates: Record<string, { id: string; label?: string | null }[]>,
  opts: ArgsStepOptions,
): Promise<ArgsStepResult> {
  const labeled = labelRefCandidates(refCandidates);
  const refPaths = Object.keys(labeled);
  const full = buildModelSchema(entry, {
    refCandidates: refEnumValues(labeled),
  });
  const schema = gateOptional(full, utterance, opts.gate, new Set(refPaths));
  const choices = choicesOf(labeled);
  const base: ArgsStepResult = {
    args: null,
    raw: null,
    error: null,
    schema,
    grammar: null,
    messages: null,
    refField: null,
    refScores: null,
    refMs: 0,
    refCfMs: 0,
    genMs: 0,
    refRequests: [],
  };
  const props = isRecord(schema.properties) ? schema.properties : {};
  if (Object.keys(props).length === 0) return { ...base, args: {} };
  const rootRefs = refPaths.filter((p) => !p.includes(".") && p in props);
  const oneOf = requireOneOf(schema, refPaths);
  const messages = argsMessages(utterance, entry, schema, choices);
  let fixed: JsonSchema = schema;
  const field = opts.scoreRefs ? scoredRefField(schema, rootRefs) : null;
  const out = { ...base, messages };
  if (field && choices[field].length > 1) {
    const labels = choices[field];
    const agg = opts.refAggregate ?? "mean";
    const cfMessages = argsMessages(CONTENT_FREE, entry, schema, choices);
    const scores: number[] = [];
    for (const label of labels) {
      const prefix = refPrefix(field, label);
      const grammar = `root ::= ${gbnfLiteral(prefix)} ("," | "}")`;
      const lp: number[] = [];
      for (const [cf, msgs] of [
        [false, messages],
        [true, cfMessages],
      ] as const) {
        const ck = scoreCacheKey(msgs, prefix);
        const hit = cf ? opts.cache?.get(ck) : undefined;
        if (hit) {
          out.refRequests.push({ ...hit, wallMs: 0, cached: true });
          lp.push(aggregate(hit.logprobs, agg));
          continue;
        }
        const r = await opts.scoreText(msgs, grammar, { maxTokens: 64 });
        const req: ScoredRequest = {
          key: label,
          offset: 0,
          contentFree: cf,
          text: r.text,
          logprobs: prefixLogprobs(r.tokens, prefix),
          tokens: r.tokens.map((t) => t.token),
          wallMs: r.wallMs,
          computeMs: r.wallMs,
          cached: false,
          promptN: r.timings?.prompt_n,
          cacheN: r.timings?.cache_n,
        };
        if (cf) {
          opts.cache?.set(ck, req);
          out.refCfMs += r.wallMs;
        } else out.refMs += r.wallMs;
        out.refRequests.push(req);
        lp.push(aggregate(req.logprobs, agg));
      }
      scores.push(lp[0] - lp[1]);
    }
    const best = labels[argmax(scores)];
    out.refField = field;
    out.refScores = Object.fromEntries(labels.map((l, i) => [l, scores[i]]));
    fixed = {
      ...schema,
      properties: { ...props, [field]: { type: "string", enum: [best] } },
    };
  }
  const grammar = argsGrammar(fixed, utterance, {
    spans: true,
    first: rootRefs,
    requireOneOf: oneOf,
  });
  const r = await opts.completeJson(
    messages,
    { kind: "grammar", grammar },
    { temperature: 0, maxTokens: 192 },
  );
  out.genMs = r.wallMs;
  out.grammar = grammar;
  out.raw = r.text;
  if (isRecord(r.parsed)) out.args = mapRefLabels(r.parsed, labeled);
  else out.error = r.parseError ?? "not an object";
  return out;
}
