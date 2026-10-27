/**
 * Step 2, round 6 format: the op's semantic fields under a copy-span GBNF,
 * with the document's referenceable items listed by label. A required ref
 * field is emitted first and its label is chosen by calibrated likelihood
 * (each label forced as the `{"<field>": "<label>"` prefix, minus the same
 * prefix under the content-free request); the args are then generated with
 * that label fixed, and the app maps labels back to ids.
 */
import {
  ANNOTATION_FIELDS,
  argsGrammar,
  gateOptional,
  labelRefCandidates,
  mapRefLabels,
  mentionsField,
  namedEnumValue,
  namesField,
  nonNull,
  refEnumValues,
  requireOneOf,
  type GateMode,
  type RefCandidate,
} from "./args-grammar.js";
import { resolveDate } from "./date-resolve.js";
import { argsSignature } from "./generator.js";
import { completeLists, type CurrentList } from "./list-completion.js";
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
  readableOpName,
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
      content: `Operation: ${entry.opName} - ${entry.description || readableOpName(entry.opName)}\n${choiceLines.join("")}Arguments: ${argsSignature(signatureSchema(schema, paths))}\nRequest: ${utterance}`,
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

function requiredEnum(schema: JsonSchema, k: string): boolean {
  const props = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const v = props[k];
  return required.includes(k) && isRecord(v) && Array.isArray(v.enum);
}

/**
 * Step-2 key order (fixed by the schema, never by scoring options): root
 * ref fields, required enum fields, other required fields, the
 * `requireOneOf` fields, then the remaining optional fields; schema order
 * within each group.
 */
export function step2Order(
  schema: JsonSchema,
  rootRefs: string[],
  oneOf: string[],
): string[] {
  const props = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const keys = Object.keys(props);
  const refs = keys.filter((k) => rootRefs.includes(k));
  const rest = keys.filter((k) => !refs.includes(k));
  return [
    ...refs,
    ...rest.filter((k) => requiredEnum(schema, k)),
    ...rest.filter((k) => required.includes(k) && !requiredEnum(schema, k)),
    ...rest.filter((k) => !required.includes(k) && oneOf.includes(k)),
    ...rest.filter((k) => !required.includes(k) && !oneOf.includes(k)),
  ];
}

/** The first required root string enum with at least 3 values. */
export function scoredEnumField(
  schema: JsonSchema,
): { field: string; values: string[] } | null {
  const props = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const k of Object.keys(props)) {
    const v = props[k];
    if (!required.includes(k) || !isRecord(v) || !Array.isArray(v.enum))
      continue;
    const values = v.enum.filter((x): x is string => typeof x === "string");
    if (values.length >= 3 && values.length === v.enum.length)
      return { field: k, values };
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
  /** Without a scored ref: score the first required string enum (≥3 values). */
  scoreEnums?: boolean;
  refAggregate?: Aggregate;
  cache?: ScoreCache;
  /**
   * Round 9 ("relax the safe gate"): optional root fields with these names
   * are never dropped by the gate, even when the utterance does not name
   * them. Default none (the r6.1 / v1 behaviour).
   */
  alwaysOffer?: readonly string[];
  /**
   * X6: grammar-only (the prompt is unchanged). Optional root fields the
   * utterance names (`namesField`) must be filled, and enum fields whose
   * value the utterance names (`namedEnumValue`) are fixed to it.
   */
  requireNamed?: boolean;
  fixNamedEnums?: boolean;
  /**
   * X9: today's date (`YYYY-MM-DD`). When the op has one date field and the
   * request names one date (`resolveDate`), the field is fixed to it.
   */
  today?: string;
  /** X9: the document's current lists for fields the op replaces whole. */
  currentLists?: Record<string, CurrentList>;
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
  /** X9: the resolved date the date field was fixed to. */
  dateFixed?: string | null;
  /** X9: list paths completed from `currentLists`. */
  listsCompleted?: string[];
}

/** Ref labels for a path (unique, in order) from labeled candidates. */
function choicesOf(labeled: Record<string, RefCandidate[]>) {
  return Object.fromEntries(
    Object.entries(labeled).map(([p, cs]) => [p, cs.map((c) => c.label)]),
  );
}

/**
 * The step-2 prompt and grammar inputs, with no model call: labeled refs,
 * the gated schema in `step2Order`, the `requireOneOf` set and the
 * messages. The runtime (`fillArgsStep`) and the training renderer both
 * build step 2 through this, so their prompt bytes are the same.
 */
export interface PreparedArgsStep {
  labeled: Record<string, RefCandidate[]>;
  /** Ref labels per path, in document order. */
  choices: Record<string, string[]>;
  /** The schema after the optional-field gate, in schema order. */
  schema: JsonSchema;
  /** `schema` with properties in `step2Order`. */
  ordered: JsonSchema;
  order: string[];
  rootRefs: string[];
  /** Ref and required-enum fields, emitted first. */
  first: string[];
  oneOf: string[];
  exactlyOne: boolean;
  /** Null when the gated op has no field (no step 2). */
  messages: WllamaChatMessage[] | null;
}

/** Root properties of `schema` named in `names` (the gate keeps them). */
export function offeredFields(
  schema: JsonSchema,
  names: readonly string[],
): string[] {
  const props = isRecord(schema.properties) ? schema.properties : {};
  return Object.keys(props).filter((k) => names.includes(k));
}

export function prepareArgsStep(
  utterance: string,
  entry: CatalogEntry,
  refCandidates: Record<string, { id: string; label?: string | null }[]>,
  gate: GateMode,
  alwaysOffer: readonly string[] = [],
): PreparedArgsStep {
  const labeled = labelRefCandidates(refCandidates);
  const refPaths = Object.keys(labeled);
  const full = buildModelSchema(entry, {
    refCandidates: refEnumValues(labeled),
  });
  const schema = gateOptional(
    full,
    utterance,
    gate,
    new Set([...refPaths, ...offeredFields(full, alwaysOffer)]),
  );
  const choices = choicesOf(labeled);
  const props = isRecord(schema.properties) ? schema.properties : {};
  const rootRefs = Object.keys(props).filter((k) => refPaths.includes(k));
  const oneOf = requireOneOf(schema, refPaths);
  // No field named: the request most plausibly sets exactly one of them.
  const exactlyOne =
    oneOf.length > 1 &&
    !oneOf.some((k) => mentionsField(k, props[k], utterance));
  const order = step2Order(schema, rootRefs, oneOf);
  const ordered: JsonSchema = {
    ...schema,
    properties: Object.fromEntries(order.map((k) => [k, props[k]])),
  };
  const first = order.filter(
    (k) => rootRefs.includes(k) || requiredEnum(ordered, k),
  );
  const messages =
    order.length > 0 ? argsMessages(utterance, entry, ordered, choices) : null;
  return {
    labeled,
    choices,
    schema,
    ordered,
    order,
    rootRefs,
    first,
    oneOf,
    exactlyOne,
    messages,
  };
}

/** The unscored step-2 grammar of a prepared step (no field fixed). */
export function preparedGrammar(
  p: PreparedArgsStep,
  utterance: string,
  schema: JsonSchema = p.ordered,
): string {
  return argsGrammar(schema, utterance, {
    spans: true,
    first: p.first,
    requireOneOf: p.oneOf,
    exactlyOne: p.exactlyOne,
  });
}

/** Optional root, non-object, non-annotation fields the utterance names. */
export function namedOptional(
  schema: JsonSchema,
  rootRefs: string[],
  utterance: string,
): string[] {
  const props = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  return Object.entries(props)
    .filter(([k, v]) => {
      if (required.includes(k) || rootRefs.includes(k)) return false;
      if (ANNOTATION_FIELDS.includes(k)) return false;
      const inner = nonNull(v);
      if (isRecord(inner) && inner.type === "object") return false;
      return namesField(k, v, utterance);
    })
    .map(([k]) => k);
}

/** Enum fields (any depth) narrowed to the one value the utterance names. */
export function fixNamed(
  schema: JsonSchema,
  utterance: string,
  skip: string[] = [],
): JsonSchema {
  const props = isRecord(schema.properties) ? schema.properties : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    const inner = nonNull(v);
    if (isRecord(inner) && inner.type === "object") {
      out[k] = fixNamed(inner, utterance);
      continue;
    }
    const named =
      !skip.includes(k) &&
      isRecord(inner) &&
      Array.isArray(inner.enum) &&
      inner.enum.length > 1
        ? namedEnumValue(inner.enum, utterance)
        : null;
    out[k] =
      named !== null && isRecord(inner) ? { ...inner, enum: [named] } : v;
  }
  return { ...schema, properties: out };
}

/** Root date and date-time fields of a model schema. */
export function dateFields(schema: JsonSchema): string[] {
  const props = isRecord(schema.properties) ? schema.properties : {};
  return Object.keys(props).filter((k) => {
    const v = nonNull(props[k]);
    return (
      isRecord(v) &&
      v.type === "string" &&
      (v.format === "date-time" || v.format === "date")
    );
  });
}

export async function fillArgsStep(
  utterance: string,
  entry: CatalogEntry,
  refCandidates: Record<string, { id: string; label?: string | null }[]>,
  opts: ArgsStepOptions,
): Promise<ArgsStepResult> {
  const resolved = opts.today ? resolveDate(utterance, opts.today) : null;
  const dates = resolved ? dateFields(buildModelSchema(entry)) : [];
  const dateField = dates.length === 1 ? dates[0] : null;
  const p = prepareArgsStep(utterance, entry, refCandidates, opts.gate, [
    ...(opts.alwaysOffer ?? []),
    ...(dateField ? [dateField] : []),
  ]);
  const { labeled, choices, schema, ordered, order, rootRefs } = p;
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
  if (!p.messages) return { ...base, args: {} };
  const messages = p.messages;
  let fixed: JsonSchema = ordered;
  const head = order[0];
  const refField =
    opts.scoreRefs && scoredRefField(ordered, rootRefs) === head ? head : null;
  const enumField =
    opts.scoreEnums &&
    rootRefs.length === 0 &&
    scoredEnumField(ordered)?.field === head
      ? scoredEnumField(ordered)
      : null;
  const field = refField ?? enumField?.field ?? null;
  const labels = refField ? choices[refField] : (enumField?.values ?? []);
  const out = { ...base, messages };
  if (field && labels.length > 1) {
    const agg = opts.refAggregate ?? "mean";
    const cfMessages = argsMessages(CONTENT_FREE, entry, ordered, choices);
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
      ...ordered,
      properties: {
        ...(ordered.properties as Record<string, unknown>),
        [field]: { type: "string", enum: [best] },
      },
    };
  }
  const mustHave = opts.requireNamed
    ? namedOptional(fixed, rootRefs, utterance)
    : [];
  if (opts.fixNamedEnums)
    fixed = fixNamed(fixed, utterance, [
      ...rootRefs,
      ...(field ? [field] : []),
    ]);
  const fixedProps = isRecord(fixed.properties) ? fixed.properties : {};
  if (resolved && dateField && dateField in fixedProps) {
    fixed = {
      ...fixed,
      properties: {
        ...fixedProps,
        [dateField]: { type: "string", enum: [`${resolved}T00:00:00Z`] },
      },
    };
    if (!mustHave.includes(dateField)) mustHave.push(dateField);
    out.dateFixed = resolved;
  }
  const grammar = argsGrammar(fixed, utterance, {
    spans: true,
    first: p.first,
    requireOneOf: p.oneOf,
    exactlyOne: p.exactlyOne && mustHave.length === 0,
    mustHave,
  });
  const r = await opts.completeJson(
    messages,
    { kind: "grammar", grammar },
    { temperature: 0, maxTokens: 192 },
  );
  out.genMs = r.wallMs;
  out.grammar = grammar;
  out.raw = r.text;
  if (isRecord(r.parsed)) {
    out.args = mapRefLabels(r.parsed, labeled);
    if (opts.currentLists) {
      const done = completeLists(out.args, opts.currentLists, utterance);
      out.args = done.args;
      out.listsCompleted = done.changed;
    }
  } else out.error = r.parseError ?? "not an object";
  return out;
}
