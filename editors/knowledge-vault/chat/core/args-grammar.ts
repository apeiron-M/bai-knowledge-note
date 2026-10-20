/**
 * Per-request GBNF for argument filling (spike round 5, "copy-span").
 * Free-text string fields may only be a contiguous run of the utterance's
 * words, with original casing; optional fields the utterance does not
 * mention are dropped; ref-id fields are an enum of candidate labels that
 * are mapped back to ids after parsing. llama.cpp compiles no token masks
 * ahead of time, so a fresh grammar per request is cheap.
 */
import { gbnfLiteral } from "./op-scorer.js";
import type { JsonSchema } from "./op-catalog.js";
import { tokenize } from "./op-retriever.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/* ------------------------------------------------------------------ */
/* Copy-span grammar                                                    */
/* ------------------------------------------------------------------ */

const LEAD = /^["'“‘([]+/;
const TRAIL = /["'”’)\].,;:!?]+$/;
const TRAIL_QUOTE = /["'”’)\]]+$/;

export function utteranceWords(utterance: string): string[] {
  return utterance.split(/\s+/).filter((w) => w.length > 0);
}

/**
 * Forms a word may take at a span edge. A span's first word may drop
 * leading quotes/brackets, its last word may drop trailing quotes (keeping
 * a final period) or all trailing punctuation; interior words are copied as
 * they are.
 */
export function wordForms(word: string): {
  full: string;
  start: string[];
  end: string[];
  single: string[];
} {
  const uniq = (xs: string[]) => [...new Set(xs.filter((x) => x.length > 0))];
  const ends = (w: string) => [
    w,
    w.replace(TRAIL_QUOTE, ""),
    w.replace(TRAIL, ""),
  ];
  const noLead = word.replace(LEAD, "");
  return {
    full: word,
    start: uniq([word, noLead]),
    end: uniq(ends(word)),
    single: uniq([...ends(word), ...ends(noLead)]),
  };
}

/** A JSON string's inner text as a GBNF literal. */
function jsonInnerLiteral(text: string): string {
  return gbnfLiteral(JSON.stringify(text).slice(1, -1));
}

function alt(xs: string[]): string {
  return xs.length === 1 ? xs[0] : `(${xs.join(" | ")})`;
}

/**
 * Rules defining `<name>` as a JSON string whose content is any contiguous
 * span (one or more words) of the utterance. O(n) rules for n words.
 */
export function spanRules(name: string, utterance: string): string[] {
  const words = utteranceWords(utterance);
  if (words.length === 0) return [`${name} ::= "\\"\\""`];
  const forms = words.map(wordForms);
  const n = words.length;
  const rules: string[] = [];
  const starts: string[] = [];
  for (let i = 0; i < n; i++) {
    const f = forms[i];
    const alts: string[] = [];
    if (f.single.length) alts.push(alt(f.single.map(jsonInnerLiteral)));
    if (i < n - 1 && f.start.length)
      alts.push(`${alt(f.start.map(jsonInnerLiteral))} " " ${name}-t${i + 1}`);
    if (alts.length) {
      rules.push(`${name}-s${i} ::= ${alts.join(" | ")}`);
      starts.push(`${name}-s${i}`);
    }
    if (i >= 1) {
      const tAlts: string[] = [];
      if (f.end.length) tAlts.push(alt(f.end.map(jsonInnerLiteral)));
      if (i < n - 1)
        tAlts.push(`${jsonInnerLiteral(f.full)} " " ${name}-t${i + 1}`);
      rules.push(`${name}-t${i} ::= ${tAlts.join(" | ")}`);
    }
  }
  rules.unshift(`${name} ::= "\\"" (${starts.join(" | ")}) "\\""`);
  return rules;
}

/* ------------------------------------------------------------------ */
/* Optional-field gating                                                */
/* ------------------------------------------------------------------ */

/** Which optional fields the gate may drop. */
export type GateMode = "none" | "closed" | "all";

function enumValues(schema: unknown): unknown[] | null {
  const s = nonNull(schema);
  if (!isRecord(s)) return null;
  if (Array.isArray(s.enum)) {
    const values: unknown[] = s.enum;
    return values;
  }
  if (s.type === "boolean") return [];
  return null;
}

/** First non-null branch of `anyOf: [X, {type: null}]`, else the schema. */
export function nonNull(schema: unknown): unknown {
  if (!isRecord(schema) || !Array.isArray(schema.anyOf)) return schema;
  const branches = schema.anyOf.filter(
    (s) => !(isRecord(s) && s.type === "null"),
  );
  return branches[0] ?? schema;
}

/**
 * Whether the utterance mentions a field: any (stemmed, non-stopword) token
 * of its name, or all tokens of one of its enum values.
 */
export function mentionsField(
  name: string,
  schema: unknown,
  utterance: string,
): boolean {
  const said = new Set(tokenize(utterance));
  if (tokenize(name).some((t) => said.has(t))) return true;
  const values = enumValues(schema) ?? [];
  return values.some((v) => {
    if (typeof v !== "string") return false;
    const toks = tokenize(v.toLowerCase());
    return toks.length > 0 && toks.every((t) => said.has(t));
  });
}

/**
 * Drop optional properties the utterance does not mention. `closed` only
 * considers enum and boolean fields (where round 1 saw invented values);
 * `all` considers every optional field. Paths in `keep` are never dropped.
 */
export function gateOptional(
  schema: JsonSchema,
  utterance: string,
  mode: GateMode,
  keep: Set<string> = new Set(),
  prefix = "",
): JsonSchema {
  const props = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((r): r is string => typeof r === "string")
    : [];
  const out: Record<string, unknown> = {};
  for (const [name, sub] of Object.entries(props)) {
    const path = prefix ? `${prefix}.${name}` : name;
    const inner = nonNull(sub);
    if (isRecord(inner) && inner.type === "object") {
      out[name] = gateOptional(inner, utterance, mode, keep, path);
      continue;
    }
    const optional = !required.includes(name);
    const gateable =
      mode === "all" || (mode === "closed" && enumValues(sub) !== null);
    if (
      optional &&
      gateable &&
      !keep.has(path) &&
      !mentionsField(name, sub, utterance)
    )
      continue;
    out[name] = sub;
  }
  return {
    ...schema,
    properties: out,
    required: required.filter((r) => r in out),
  };
}

/* ------------------------------------------------------------------ */
/* Whole-object grammar                                                 */
/* ------------------------------------------------------------------ */

const PRIMITIVES = [
  String.raw`jstr ::= "\"" jchar* "\""`,
  String.raw`jchar ::= [^"\\\x7F\x00-\x1F] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F])`,
  String.raw`jint ::= "-"? [0-9]+`,
  String.raw`jnum ::= "-"? [0-9]+ ("." [0-9]+)?`,
  String.raw`jbool ::= "true" | "false"`,
  String.raw`d2 ::= [0-9] [0-9]`,
  String.raw`jdatetime ::= "\"" d2 d2 "-" d2 "-" d2 "T" d2 ":" d2 ":" d2 ("." [0-9]+)? "Z\""`,
];

export interface ArgsGrammarOptions {
  /** Constrain free-text strings to utterance spans (else any string). */
  spans: boolean;
}

/**
 * GBNF for a model schema (as `buildModelSchema` returns it, possibly
 * gated). Output is compact JSON: `{"a": 1, "b": "x"}`. Required properties
 * come first; when an object has no required property, at least one
 * property must be present.
 */
export function argsGrammar(
  schema: JsonSchema,
  utterance: string,
  opts: ArgsGrammarOptions,
): string {
  const rules: string[] = [];
  let n = 0;
  const used = { span: false };
  const fresh = () => `r${n++}`;

  function value(s: unknown): string {
    const v = nonNull(s);
    if (!isRecord(v)) return "jstr";
    if (Array.isArray(v.enum)) {
      return alt(v.enum.map((e) => gbnfLiteral(JSON.stringify(e))));
    }
    switch (v.type) {
      case "integer":
        return "jint";
      case "number":
        return "jnum";
      case "boolean":
        return "jbool";
      case "array": {
        const item = value(v.items);
        const name = fresh();
        rules.push(`${name} ::= "[" (${item} (", " ${item})*)? "]"`);
        return name;
      }
      case "object":
        return object(v);
      case "string":
        if (v.format === "date-time" || v.format === "date") return "jdatetime";
        if (opts.spans) {
          used.span = true;
          return "span";
        }
        return "jstr";
      default:
        return "jstr";
    }
  }

  function object(s: Record<string, unknown>): string {
    const props = isRecord(s.properties) ? s.properties : {};
    const required = Array.isArray(s.required) ? s.required : [];
    const names = Object.keys(props);
    const ordered = [
      ...names.filter((k) => required.includes(k)),
      ...names.filter((k) => !required.includes(k)),
    ];
    const name = fresh();
    if (ordered.length === 0) {
      rules.push(`${name} ::= "{}"`);
      return name;
    }
    const member = (k: string) =>
      `${gbnfLiteral(JSON.stringify(k) + ": ")} ${value(props[k])}`;
    const members = ordered.map(member);
    const nReq = ordered.filter((k) => required.includes(k)).length;
    let body: string;
    if (nReq > 0) {
      body = members
        .map((m, i) =>
          i === 0 ? m : i < nReq ? `", " ${m}` : `(", " ${m})?`,
        )
        .join(" ");
    } else {
      // No required member: one of them first, then optional later ones.
      body = alt(
        members.map((m, i) =>
          [m, ...members.slice(i + 1).map((x) => `(", " ${x})?`)].join(" "),
        ),
      );
    }
    rules.push(`${name} ::= "{" ${body} "}"`);
    return name;
  }

  const root = object(schema);
  const out = [`root ::= ${root}`, ...rules, ...PRIMITIVES];
  if (used.span) out.push(...spanRules("span", utterance));
  return out.join("\n");
}

/* ------------------------------------------------------------------ */
/* Ref-id labels                                                        */
/* ------------------------------------------------------------------ */

export interface RefCandidate {
  id: string;
  label: string;
}

/**
 * Enum values per ref path: the labels when they are unique within the
 * path, else the ids.
 */
export function refEnumValues(
  refCandidates: Record<string, RefCandidate[]>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(refCandidates).map(([path, cands]) => {
      const labels = cands.map((c) => c.label);
      const unique = new Set(labels).size === labels.length;
      return [path, unique ? labels : cands.map((c) => c.id)];
    }),
  );
}

/** Copy of `args` with label values at ref paths replaced by their ids. */
export function mapRefLabels(
  args: Record<string, unknown>,
  refCandidates: Record<string, RefCandidate[]>,
): Record<string, unknown> {
  const out = structuredClone(args);
  for (const [path, cands] of Object.entries(refCandidates)) {
    const keys = path.split(".");
    let parent: Record<string, unknown> | null = out;
    for (const k of keys.slice(0, -1)) {
      const next: unknown = parent?.[k];
      parent = isRecord(next) ? next : null;
    }
    const leaf = keys[keys.length - 1];
    if (!parent || !(leaf in parent)) continue;
    const toId = (v: unknown) => cands.find((c) => c.label === v)?.id ?? v;
    const cur = parent[leaf];
    parent[leaf] = Array.isArray(cur) ? cur.map(toId) : toId(cur);
  }
  return out;
}
