/**
 * Round 5 experiments: likelihood scoring, calibration, order averaging,
 * readable labels, BM25 fusion and copy-span args, on the dev (seed) set and
 * the held-out set.
 */
import {
  argsGrammar,
  gateOptional,
  mapRefLabels,
  refEnumValues,
  type GateMode,
  type RefCandidate,
} from "../../editors/knowledge-vault/chat/core/args-grammar.js";
import { buildAction } from "../../editors/knowledge-vault/chat/core/envelope.js";
import {
  fillArgs,
  fillArgsMessages,
  selectOp,
} from "../../editors/knowledge-vault/chat/core/generator.js";
import type { LlmClient } from "../../editors/knowledge-vault/chat/core/llm-client.js";
import {
  buildModelSchema,
  leafFields,
  type CatalogEntry,
} from "../../editors/knowledge-vault/chat/core/op-catalog.js";
import { createOpRetriever } from "../../editors/knowledge-vault/chat/core/op-retriever.js";
import {
  forcedOpText,
  fuse,
  argmax,
  literalGrammar,
  NONE_KEY,
  pickFromRequests,
  rotationOffsets,
  scoreOptions,
  scoringMessages,
  toOptions,
  type Aggregate,
  type LabelStyle,
} from "../../editors/knowledge-vault/chat/core/op-scorer.js";
import heldout from "./eval/heldout-eval.json" with { type: "json" };
import seed from "./eval/seed-utterances.json" with { type: "json" };

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function r5Catalog() {
  const { buildVaultCatalog } =
    await import("../../editors/knowledge-vault/chat/core/catalog-models.js");
  const catalog = buildVaultCatalog();
  const retriever = createOpRetriever(catalog);
  const get = (key: string): CatalogEntry => {
    const e = catalog.find((c) => c.key === key);
    if (!e) throw new Error(`missing ${key}`);
    return e;
  };
  return { catalog, retriever, get };
}

/* ------------------------------------------------------------------ */
/* Eval items                                                           */
/* ------------------------------------------------------------------ */

export interface EvalItem {
  id: string;
  utterance: string;
  docType: string;
  /** null for no-action items. */
  expectedOp: string | null;
  args?: Json;
  ambiguousArgs?: Json;
  refArgs?: Json;
  argMatch?: Record<string, string>;
  requiredPresent?: string[];
  refCandidates?: Record<string, RefCandidate[]>;
}

export type EvalSet = "dev" | "heldout" | "noaction";

interface HeldoutItem {
  id: string;
  utterance: string;
  context: { docType: string; refCandidates?: Record<string, RefCandidate[]> };
  expected: {
    op: string;
    args?: Json;
    ambiguousArgs?: Json;
    refArgs?: Json;
    argMatch?: Record<string, string>;
  };
  requiredPresent?: string[];
}

interface HeldoutFile {
  items: HeldoutItem[];
  noAction: { id: string; utterance: string; context: { docType: string } }[];
}

export function loadItems(set: EvalSet): EvalItem[] {
  if (set === "dev") {
    return seed.map((s, i) => ({
      id: `dev-${String(i + 1).padStart(2, "0")}`,
      utterance: s.utterance,
      docType: s.docType,
      expectedOp: s.expectedKey,
      args: s.expectedArgs,
    }));
  }
  const file = heldout as unknown as HeldoutFile;
  if (set === "noaction") {
    return file.noAction.map((n) => ({
      id: n.id,
      utterance: n.utterance,
      docType: n.context.docType,
      expectedOp: null,
    }));
  }
  return file.items.map((it) => ({
    id: it.id,
    utterance: it.utterance,
    docType: it.context.docType,
    expectedOp: it.expected.op,
    args: it.expected.args,
    ambiguousArgs: it.expected.ambiguousArgs,
    refArgs: it.expected.refArgs,
    argMatch: it.expected.argMatch,
    requiredPresent: it.requiredPresent,
    refCandidates: it.context.refCandidates,
  }));
}

/* ------------------------------------------------------------------ */
/* Arg comparison                                                       */
/* ------------------------------------------------------------------ */

/** Leaf values by dotted path; arrays are leaves. */
export function flatten(v: unknown, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (isRecord(v)) {
    for (const [k, sub] of Object.entries(v)) {
      for (const [p, x] of flatten(sub, prefix ? `${prefix}.${k}` : k))
        out.set(p, x);
    }
  } else if (prefix) out.set(prefix, v);
  return out;
}

function isEmpty(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    v === "" ||
    (Array.isArray(v) && v.length === 0)
  );
}

function ciNorm(v: unknown): unknown {
  return typeof v === "string" ? v.trim().toLowerCase() : v;
}

export function matchValue(
  got: unknown,
  want: unknown,
  how: string | undefined,
): boolean {
  if (how === "date") {
    return (
      typeof got === "string" &&
      typeof want === "string" &&
      got.slice(0, 10) === want.slice(0, 10)
    );
  }
  const ci = how === "ci" || how === "ci-unordered";
  const unordered = how === "unordered" || how === "ci-unordered";
  if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length) return false;
    const g = got.map((x) => JSON.stringify(ci ? ciNorm(x) : x));
    const w = want.map((x) => JSON.stringify(ci ? ciNorm(x) : x));
    if (unordered) {
      g.sort();
      w.sort();
    }
    return g.every((x, i) => x === w[i]);
  }
  if (ci) return ciNorm(got) === ciNorm(want);
  return JSON.stringify(got) === JSON.stringify(want);
}

export interface ArgScore {
  /** Expected `args` fields all match (null when the item has none). */
  fieldsMatch: boolean | null;
  /** Non-empty semantic fields outside args/ambiguousArgs/refs. */
  extras: string[];
  /** fieldsMatch and no extras (null when the item has no `args`). */
  exact: boolean | null;
  requiredPresent: boolean | null;
  refExact: boolean | null;
  mismatched: string[];
}

export function scoreArgs(
  item: EvalItem,
  got: Json | null,
  refPaths: string[],
): ArgScore {
  const g = flatten(got ?? {});
  const want = flatten(item.args ?? {});
  const mismatched: string[] = [];
  for (const [p, w] of want) {
    if (!matchValue(g.get(p), w, item.argMatch?.[p])) mismatched.push(p);
  }
  const allowed = [
    ...want.keys(),
    ...flatten(item.ambiguousArgs ?? {}).keys(),
    ...Object.keys(item.ambiguousArgs ?? {}),
    ...refPaths,
  ];
  const extras = [...g]
    .filter(([, v]) => !isEmpty(v))
    .map(([p]) => p)
    .filter((p) => !allowed.some((a) => p === a || p.startsWith(`${a}.`)));
  const hasArgs = item.args !== undefined && want.size > 0;
  const fieldsMatch = hasArgs ? mismatched.length === 0 : null;
  const refs = flatten(item.refArgs ?? {});
  let refExact: boolean | null = null;
  if (item.refArgs) {
    refExact = [...refs].every(([p, w]) =>
      matchValue(g.get(p), w, item.argMatch?.[p] ?? "unordered"),
    );
  }
  let requiredPresent: boolean | null = null;
  if (item.requiredPresent?.length) {
    requiredPresent = item.requiredPresent.every((p) => !isEmpty(g.get(p)));
  }
  return {
    fieldsMatch,
    extras,
    exact: hasArgs ? fieldsMatch === true && extras.length === 0 : null,
    requiredPresent,
    refExact,
    mismatched,
  };
}

/* ------------------------------------------------------------------ */
/* Stats                                                                */
/* ------------------------------------------------------------------ */

function pct(n: number, d: number): number | null {
  return d === 0 ? null : Math.round((1000 * n) / d) / 10;
}

function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, i)]);
}

/* ------------------------------------------------------------------ */
/* Op selection                                                         */
/* ------------------------------------------------------------------ */

export const LAMBDAS = [0.5, 1, 2, 3, 5, 8];
const N_ORDERS = 3;

interface OpsOptions {
  set: EvalSet;
  scoped: boolean;
  style: LabelStyle;
  /** Also run B1 (sampled enum op). */
  withB1: boolean;
  includeNone: boolean;
  /** Rotation count for S3 (S1/S2 always use the first ordering). */
  orders?: number;
}

/**
 * One pass over an eval set. Every scoring method is derived from the same
 * forced-literal requests, so S1/S2/S3/H1 differ only in arithmetic; each
 * method's latency is the summed wall time of the requests it would need.
 */
export async function evalOps(c: LlmClient, o: OpsOptions): Promise<Json> {
  const { retriever, get } = await r5Catalog();
  const items = loadItems(o.set);
  const offsets = rotationOffsets(5, o.orders ?? N_ORDERS);
  const statusEl = document.getElementById("status");
  const rows: Json[] = [];
  for (const [n, item] of items.entries()) {
    if (statusEl) statusEl.textContent = `r5 ops ${n + 1}/${items.length}`;
    const hits = retriever.retrieve(item.utterance, {
      k: 5,
      docType: o.scoped ? item.docType : undefined,
    });
    const cands = hits.map((h) => get(h.entry.key));
    const keys = cands.map((e) => e.key);
    const bm25 = hits.map((h) => h.score);
    const picks: Record<string, string | null> = { B0: keys[0] ?? null };
    const wall: Record<string, number> = { B0: 0 };
    let b1Raw: string | null = null;
    if (o.withB1) {
      const r = await selectOp(item.utterance, cands, {
        completeJson: c.completeJson,
      });
      picks.B1 = r.key;
      wall.B1 = r.result.wallMs;
      b1Raw = r.result.text;
    }
    const reqs = await scoreOptions(item.utterance, cands, {
      scoreText: c.scoreText,
      style: o.style,
      offsets,
      contentFree: true,
      includeNone: o.includeNone,
    });
    const allKeys = o.includeNone ? [...keys, NONE_KEY] : keys;
    const scores: Record<string, Record<string, number>> = {};
    for (const agg of ["sum", "mean"] as Aggregate[]) {
      const variants = {
        [`S1-${agg}`]: { calibrated: false, offsets: [0] },
        [`S2-${agg}`]: { calibrated: true, offsets: [0] },
        [`S3-${agg}`]: { calibrated: true, offsets },
        [`S1x3-${agg}`]: { calibrated: false, offsets },
      };
      for (const [name, v] of Object.entries(variants)) {
        const p = pickFromRequests(reqs, allKeys, { aggregate: agg, ...v });
        picks[name] = p.key;
        wall[name] = p.wallMs;
        scores[name] = p.scores;
        if (name.startsWith("S2") || name.startsWith("S3")) {
          // Hybrid: calibrated LLM score + λ × normalized BM25 (none gets 0).
          const llm = allKeys.map((k) => p.scores[k]);
          const bm = allKeys.map((k) => bm25[keys.indexOf(k)] ?? 0);
          for (const lambda of LAMBDAS) {
            const f = fuse(llm, bm, lambda);
            const name2 = `H1-${name}-l${lambda}`;
            picks[name2] = allKeys[argmax(f)] ?? null;
            wall[name2] = p.wallMs;
          }
        }
      }
    }
    rows.push({
      id: item.id,
      utterance: item.utterance,
      expectedOp: item.expectedOp,
      candidates: keys,
      bm25,
      inCandidates: item.expectedOp ? keys.includes(item.expectedOp) : null,
      picks,
      wall,
      scores,
      b1Raw,
      requests: reqs.map((r) => ({
        key: r.key,
        offset: r.offset,
        cf: r.contentFree,
        lp: r.logprobs.map((x) => Math.round(x * 1000) / 1000),
        ms: Math.round(r.wallMs),
        promptN: r.promptN,
        cacheN: r.cacheN,
      })),
    });
  }
  return {
    summary: summarizeOps(rows, o),
    rows,
  };
}

function summarizeOps(rows: Json[], o: OpsOptions): Json {
  const methods = Object.keys((rows[0]?.picks as Json | undefined) ?? {});
  const n = rows.length;
  const inCand = rows.filter((r) => r.inCandidates === true);
  const out: Json = {
    set: o.set,
    scoped: o.scoped,
    style: o.style,
    includeNone: o.includeNone,
    n,
    recallAt5: o.set === "noaction" ? null : pct(inCand.length, n),
  };
  const per: Json = {};
  for (const m of methods) {
    const pick = (r: Json) => (r.picks as Record<string, string | null>)[m];
    const want = (r: Json) => (r.expectedOp as string | null) ?? NONE_KEY;
    const correct = rows.filter((r) => pick(r) === want(r)).length;
    const walls = rows.map((r) => (r.wall as Record<string, number>)[m]);
    per[m] = {
      acc: pct(correct, n),
      correct,
      accGivenIn:
        o.set === "noaction"
          ? null
          : pct(inCand.filter((r) => pick(r) === want(r)).length, inCand.length),
      pickedNone: rows.filter((r) => pick(r) === NONE_KEY).length,
      medianMs: quantile(walls, 0.5),
      p90Ms: quantile(walls, 0.9),
    };
  }
  out.methods = per;
  return out;
}

/* ------------------------------------------------------------------ */
/* Args                                                                 */
/* ------------------------------------------------------------------ */

interface ArgsOptions {
  set: EvalSet;
  mode: "A0" | "A1";
  gate: GateMode;
}

function refIdValues(
  refs: Record<string, RefCandidate[]> | undefined,
): Record<string, string[]> | undefined {
  if (!refs) return undefined;
  return Object.fromEntries(
    Object.entries(refs).map(([p, cs]) => [p, cs.map((x) => x.id)]),
  );
}

/** Args for the expected (oracle) op of every item. */
export async function evalArgs(c: LlmClient, o: ArgsOptions): Promise<Json> {
  const { get } = await r5Catalog();
  const items = loadItems(o.set).filter((i) => i.expectedOp);
  const statusEl = document.getElementById("status");
  const rows: Json[] = [];
  for (const [n, item] of items.entries()) {
    if (statusEl) statusEl.textContent = `r5 args ${n + 1}/${items.length}`;
    const entry = get(item.expectedOp ?? "");
    const refPaths = Object.keys(item.refCandidates ?? {});
    let args: Json | null = null;
    let raw: string | null = null;
    let wallMs = 0;
    let grammar: string | null = null;
    let error: string | null = null;
    try {
      if (o.mode === "A0") {
        const r = await fillArgs(item.utterance, entry, {
          completeJson: c.completeJson,
          refCandidates: refIdValues(item.refCandidates),
        });
        args = r.args;
        raw = r.result?.text ?? null;
        wallMs = r.result?.wallMs ?? 0;
      } else {
        const refs = item.refCandidates ?? {};
        const schema = gateOptional(
          buildModelSchema(entry, { refCandidates: refEnumValues(refs) }),
          item.utterance,
          o.gate,
          new Set(refPaths),
        );
        const props = isRecord(schema.properties) ? schema.properties : {};
        if (Object.keys(props).length === 0) {
          args = {};
        } else {
          grammar = argsGrammar(schema, item.utterance, { spans: true });
          const r = await c.completeJson(
            fillArgsMessages(item.utterance, entry, schema),
            { kind: "grammar", grammar },
            { temperature: 0, maxTokens: 192 },
          );
          raw = r.text;
          wallMs = r.wallMs;
          args = isRecord(r.parsed) ? mapRefLabels(r.parsed, refs) : null;
          if (!args) error = r.parseError ?? "not an object";
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const score = scoreArgs(item, args, refPaths);
    let zodOk: boolean | null = null;
    if (args) {
      const refIds = Object.fromEntries(
        leafFields(entry.fields)
          .filter((f) => f.fieldClass === "ref-id")
          .map((f) => [f.path.join("."), f.list ? ["ref-1"] : "ref-1"]),
      );
      zodOk = buildAction(entry, args, {
        generateId: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
        actor: "ben",
        refIds,
      }).ok;
    }
    rows.push({
      id: item.id,
      utterance: item.utterance,
      op: item.expectedOp,
      expected: {
        args: item.args ?? null,
        refArgs: item.refArgs ?? null,
        ambiguous: item.ambiguousArgs ?? null,
      },
      args,
      raw,
      error,
      wallMs: Math.round(wallMs),
      called: raw !== null,
      zodOk,
      grammarChars: grammar?.length ?? null,
      ...score,
    });
  }
  const cnt = (k: string, v: unknown) => rows.filter((r) => r[k] === v).length;
  const scored = (k: string) => rows.filter((r) => r[k] !== null).length;
  const walls = rows.filter((r) => r.called).map((r) => r.wallMs as number);
  return {
    summary: {
      set: o.set,
      mode: o.mode,
      gate: o.gate,
      n: rows.length,
      exact: pct(cnt("exact", true), scored("exact")),
      exactN: `${cnt("exact", true)}/${scored("exact")}`,
      fieldsMatch: pct(cnt("fieldsMatch", true), scored("fieldsMatch")),
      fieldsMatchN: `${cnt("fieldsMatch", true)}/${scored("fieldsMatch")}`,
      withExtras: rows.filter((r) => (r.extras as string[]).length > 0).length,
      requiredPresentN: `${cnt("requiredPresent", true)}/${scored("requiredPresent")}`,
      refExactN: `${cnt("refExact", true)}/${scored("refExact")}`,
      zodOkN: `${cnt("zodOk", true)}/${scored("zodOk")}`,
      errors: rows.filter((r) => r.error).length,
      calls: walls.length,
      medianMs: quantile(walls, 0.5),
      p90Ms: quantile(walls, 0.9),
    },
    rows,
  };
}

/* ------------------------------------------------------------------ */
/* Probe                                                                */
/* ------------------------------------------------------------------ */

/**
 * Checks that forced-literal logprobs are usable scores: negative, equal to
 * the unconstrained greedy logprobs on the greedy path, identical across
 * candidates on a shared prefix, and repeatable.
 */
export async function probeLogprobs(c: LlmClient): Promise<Json> {
  const { retriever } = await r5Catalog();
  const utterance = "tag this note with distributed systems";
  const cands = retriever
    .retrieve(utterance, { k: 5, docType: "bai/knowledge-note" })
    .map((h) => h.entry);
  const messages = scoringMessages(utterance, toOptions(cands, "key"));
  const brief = (r: Awaited<ReturnType<LlmClient["scoreText"]>>) => ({
    text: r.text,
    finish: r.finishReason,
    wallMs: Math.round(r.wallMs),
    timings: r.timings,
    tokens: r.tokens.map((t) => ({
      t: t.token,
      lp: t.logprob,
      top: t.top_logprobs.map((x) => [x.token, x.logprob]),
    })),
  });
  const greedy = await c.scoreText(messages, "", {
    maxTokens: 24,
    topLogprobs: 3,
  });
  const greedyForced = await c.scoreText(
    messages,
    literalGrammar(greedy.text),
    { topLogprobs: 3 },
  );
  const forced = [];
  for (const cand of cands) {
    forced.push(
      brief(
        await c.scoreText(messages, literalGrammar(forcedOpText(cand.key)), {
          topLogprobs: 3,
        }),
      ),
    );
  }
  const repeat = brief(
    await c.scoreText(messages, literalGrammar(forcedOpText(cands[0].key)), {
      topLogprobs: 3,
    }),
  );
  // An unlikely literal: should be strongly negative if logprobs are raw.
  const junk = brief(
    await c.scoreText(messages, literalGrammar('{"op": "zebra"}'), {
      topLogprobs: 3,
    }),
  );
  return {
    candidates: cands.map((e) => e.key),
    greedy: brief(greedy),
    greedyForced: brief(greedyForced),
    forced,
    repeat,
    junk,
  };
}
