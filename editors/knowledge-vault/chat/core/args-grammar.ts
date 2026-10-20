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

/**
 * Which optional fields the gate may drop. `safe` (round 6) is `all`, except
 * that an object whose semantic fields are all optional never loses all of
 * them: when the utterance mentions none, every one is kept (and
 * `argsGrammar`'s `requireOneOf` then asks for at least one).
 */
export type GateMode = "none" | "closed" | "all" | "safe";

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
      mode === "all" ||
      mode === "safe" ||
      (mode === "closed" && enumValues(sub) !== null);
    if (
      optional &&
      gateable &&
      !keep.has(path) &&
      !mentionsField(name, sub, utterance)
    )
      continue;
    out[name] = sub;
  }
  if (mode === "safe") {
    const free = semanticOptional(props, required, keep, prefix);
    const anyRequired = Object.keys(props).some(
      (k) => required.includes(k) && !keep.has(prefix ? `${prefix}.${k}` : k),
    );
    if (!anyRequired && free.length > 0 && !free.some((k) => k in out)) {
      // Never empty an op: keep every optional field, in schema order.
      const restored: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props))
        if (k in out || free.includes(k)) restored[k] = out[k] ?? v;
      return { ...schema, properties: restored, required };
    }
  }
  return {
    ...schema,
    properties: out,
    required: required.filter((r) => r in out),
  };
}

/**
 * Optional annotations that an op is complete without (the knowledge-note
 * lifecycle `comment`): the safe gate never restores or requires them.
 */
export const ANNOTATION_FIELDS = ["comment"];

/** Optional, non-object properties that are not kept (ref) paths. */
function semanticOptional(
  props: Record<string, unknown>,
  required: string[],
  keep: Set<string>,
  prefix: string,
): string[] {
  return Object.entries(props)
    .filter(([k, v]) => {
      const inner = nonNull(v);
      const path = prefix ? `${prefix}.${k}` : k;
      return (
        !required.includes(k) &&
        !keep.has(path) &&
        !ANNOTATION_FIELDS.includes(k) &&
        !(isRecord(inner) && inner.type === "object")
      );
    })
    .map(([k]) => k);
}

/**
 * Root fields of which at least one must be present: the optional semantic
 * fields of an op that has no required semantic field (e.g. ASSIGN_GOAL's
 * `assignee` beside the ref `id`). Empty when some semantic field is
 * required.
 */
export function requireOneOf(schema: JsonSchema, refPaths: string[]): string[] {
  const props = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((r): r is string => typeof r === "string")
    : [];
  const keep = new Set(refPaths);
  const anyRequired = Object.keys(props).some(
    (k) => required.includes(k) && !keep.has(k),
  );
  return anyRequired ? [] : semanticOptional(props, required, keep, "");
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
  /** Root fields emitted first, in this order (e.g. ref fields). */
  first?: string[];
  /**
   * Root optional fields of which at least one must be present (see
   * `requireOneOf`). They follow the required fields.
   */
  requireOneOf?: string[];
  /** With `requireOneOf`: exactly one of them, not at least one. */
  exactlyOne?: boolean;
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

  /**
   * Members in order, each required or optional, with at least one member
   * of the flagged set present when `needOne`. Built right to left over
   * states (position, something emitted yet, set satisfied yet), so the
   * grammar stays linear in the number of members. Returns "" for an empty
   * body and null when no sentence is possible.
   */
  function sequence(
    members: { lit: string; req: boolean; inSet: boolean }[],
    needOne: boolean,
  ): string | null {
    const memo = new Map<string, string | null>();
    const n = members.length;
    function from(i: number, emitted: boolean, sat: boolean): string | null {
      if (i === n) return sat ? "" : null;
      const key = `${i}:${emitted}:${sat}`;
      if (memo.has(key)) return memo.get(key) ?? null;
      const m = members[i];
      const next = from(i + 1, true, sat || m.inSet);
      const blocked = Boolean(opts.exactlyOne) && sat && m.inSet;
      const emit =
        next === null || blocked
          ? null
          : [emitted ? `", " ${m.lit}` : m.lit, next].filter(Boolean).join(" ");
      let out: string | null = emit;
      if (!m.req) {
        const skip = from(i + 1, emitted, sat);
        if (emit === null) out = skip;
        else if (skip === "") out = `(${emit})?`;
        else if (skip !== null) out = `(${emit} | ${skip})`;
      }
      if (out !== null && out !== "") {
        const name = fresh();
        rules.push(`${name} ::= ${out}`);
        out = name;
      }
      memo.set(key, out);
      return out;
    }
    return from(0, false, !needOne);
  }

  function object(s: Record<string, unknown>, isRoot = false): string {
    const props = isRecord(s.properties) ? s.properties : {};
    const reqList: unknown[] = Array.isArray(s.required) ? s.required : [];
    const names = Object.keys(props);
    const first = isRoot ? (opts.first ?? []).filter((k) => k in props) : [];
    const oneOf = isRoot
      ? (opts.requireOneOf ?? []).filter(
          (k) => k in props && !reqList.includes(k) && !first.includes(k),
        )
      : [];
    const rest = names.filter((k) => !first.includes(k) && !oneOf.includes(k));
    const ordered = [
      ...first,
      ...rest.filter((k) => reqList.includes(k)),
      ...oneOf,
      ...rest.filter((k) => !reqList.includes(k)),
    ];
    const name = fresh();
    const anyReq = ordered.some((k) => reqList.includes(k));
    // At least one of `oneOf`; with no required member, at least one member.
    const set = oneOf.length > 0 ? oneOf : anyReq ? [] : ordered;
    const body = sequence(
      ordered.map((k) => ({
        lit: `${gbnfLiteral(JSON.stringify(k) + ": ")} ${value(props[k])}`,
        req: reqList.includes(k),
        inSet: set.includes(k),
      })),
      set.length > 0,
    );
    rules.push(body ? `${name} ::= "{" ${body} "}"` : `${name} ::= "{}"`);
    return name;
  }

  const root = object(schema, true);
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

/**
 * Candidates with unique, non-empty labels (round 6, the LoRA plan's
 * labeled refs): a missing label becomes the id, and a repeated label gets
 * ` (2)`, ` (3)`, … in list order. Pass the result to `refEnumValues` and
 * `mapRefLabels` so the model chooses a label and the app maps it to an id.
 */
export function labelRefCandidates(
  refCandidates: Record<string, { id: string; label?: string | null }[]>,
): Record<string, RefCandidate[]> {
  return Object.fromEntries(
    Object.entries(refCandidates).map(([path, cands]) => {
      const seen = new Map<string, number>();
      const taken = new Set<string>();
      const out = cands.map((c) => {
        const base = c.label?.trim() ? c.label.trim() : c.id;
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        let label = n === 1 ? base : `${base} (${n})`;
        while (taken.has(label)) label = `${label}'`;
        taken.add(label);
        return { id: c.id, label };
      });
      return [path, out];
    }),
  );
}
