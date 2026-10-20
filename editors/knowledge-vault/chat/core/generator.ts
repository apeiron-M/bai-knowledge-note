import type { CompleteJson, JsonResult } from "./llm-client.js";
import {
  buildModelSchema,
  type CatalogEntry,
  type JsonSchema,
} from "./op-catalog.js";
import type { WllamaChatMessage } from "./wllama-types.js";

export interface StepTiming {
  wallMs: number;
  promptN?: number;
  promptPerSecond?: number;
  predictedN?: number;
  predictedPerSecond?: number;
}

export interface GenerateResult {
  key: string | null;
  args: Record<string, unknown> | null;
  raw: { step1: string; step2: string | null };
  /** Set when a step's output did not parse or matched no candidate. */
  error?: string;
  timings: { step1: StepTiming; step2: StepTiming | null };
}

export interface GenerateOptions {
  completeJson: CompleteJson;
  temperature?: number;
  seed?: number;
  /** Candidate ids per ref-id field, keyed by dotted path. */
  refCandidates?: Record<string, string[]>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function timing(r: JsonResult): StepTiming {
  return {
    wallMs: r.wallMs,
    promptN: r.timings?.prompt_n,
    promptPerSecond: r.timings?.prompt_per_second,
    predictedN: r.timings?.predicted_n,
    predictedPerSecond: r.timings?.predicted_per_second,
  };
}

export function opEnumSchema(keys: string[]): JsonSchema {
  return {
    type: "object",
    properties: { op: { type: "string", enum: keys } },
    required: ["op"],
    additionalProperties: false,
  };
}

function fieldList(entry: CatalogEntry): string {
  const props = entry.modelSchema.properties;
  const names = isRecord(props) ? Object.keys(props) : [];
  return names.length ? names.join(", ") : "none";
}

export function selectOpMessages(
  utterance: string,
  candidates: CatalogEntry[],
): WllamaChatMessage[] {
  const lines = candidates.map(
    (c) =>
      `- ${c.key}: ${c.description || c.opName.toLowerCase().replace(/_/g, " ")} (fields: ${fieldList(c)})`,
  );
  return [
    {
      role: "system",
      content:
        "You choose the single document operation that carries out the user's request. Answer with JSON.",
    },
    {
      role: "user",
      content: `Operations:\n${lines.join("\n")}\n\nRequest: ${utterance}`,
    },
  ];
}

function typeSignature(schema: unknown): string {
  if (!isRecord(schema)) return "any";
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.map(typeSignature).join(" | ");
  }
  if (schema.type === "array") return `${typeSignature(schema.items)}[]`;
  if (schema.type === "object") return argsSignature(schema);
  return typeof schema.type === "string" ? schema.type : "any";
}

/** Compact `{"name": string, "role"?: string}` rendering of a model schema. */
export function argsSignature(schema: JsonSchema): string {
  const props = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const parts = Object.entries(props).map(
    ([k, v]) => `"${k}"${required.includes(k) ? "" : "?"}: ${typeSignature(v)}`,
  );
  return `{${parts.join(", ")}}`;
}

export function fillArgsMessages(
  utterance: string,
  entry: CatalogEntry,
  schema: JsonSchema = entry.modelSchema,
): WllamaChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You extract the arguments for a document operation from the user's request. Copy names and text from the request exactly. Answer with JSON.",
    },
    {
      role: "user",
      // The signature line stops the 350M model from running on inside
      // string values (observed without it: "distributed_systems_example_1_2_3_4_5").
      content: `Operation: ${entry.opName} - ${entry.description}\nArguments: ${argsSignature(schema)}\nRequest: ${utterance}`,
    },
  ];
}

/** Step 1: pick one of the candidate ops under an enum constraint. */
export async function selectOp(
  utterance: string,
  candidates: CatalogEntry[],
  opts: GenerateOptions,
): Promise<{ key: string | null; result: JsonResult }> {
  const keys = candidates.map((c) => c.key);
  const result = await opts.completeJson(
    selectOpMessages(utterance, candidates),
    { kind: "json_schema", name: "select_op", schema: opEnumSchema(keys) },
    { temperature: opts.temperature ?? 0, seed: opts.seed, maxTokens: 64 },
  );
  const op = isRecord(result.parsed) ? result.parsed.op : undefined;
  const key = typeof op === "string" && keys.includes(op) ? op : null;
  return { key, result };
}

/** Step 2: fill the op's semantic fields under its model schema. */
export async function fillArgs(
  utterance: string,
  entry: CatalogEntry,
  opts: GenerateOptions,
): Promise<{
  args: Record<string, unknown> | null;
  result: JsonResult | null;
}> {
  const schema = buildModelSchema(entry, { refCandidates: opts.refCandidates });
  const props = schema.properties;
  if (!isRecord(props) || Object.keys(props).length === 0) {
    return { args: {}, result: null };
  }
  const result = await opts.completeJson(
    fillArgsMessages(utterance, entry, schema),
    { kind: "json_schema", name: entry.opName.toLowerCase(), schema },
    { temperature: opts.temperature ?? 0, seed: opts.seed, maxTokens: 192 },
  );
  return { args: isRecord(result.parsed) ? result.parsed : null, result };
}

/** Two-step constrained generation: op selection, then argument filling. */
export async function generateAction(
  utterance: string,
  candidates: CatalogEntry[],
  opts: GenerateOptions,
): Promise<GenerateResult> {
  const step1 = await selectOp(utterance, candidates, opts);
  const base = {
    raw: { step1: step1.result.text, step2: null },
    timings: { step1: timing(step1.result), step2: null },
  };
  const entry = candidates.find((c) => c.key === step1.key);
  if (!entry) {
    return { ...base, key: null, args: null, error: "no candidate selected" };
  }
  const step2 = await fillArgs(utterance, entry, opts);
  return {
    key: entry.key,
    args: step2.args,
    raw: { step1: step1.result.text, step2: step2.result?.text ?? null },
    timings: {
      step1: timing(step1.result),
      step2: step2.result ? timing(step2.result) : null,
    },
    error: step2.args ? undefined : "args did not parse",
  };
}
