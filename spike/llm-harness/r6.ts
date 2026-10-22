/**
 * Round 6 experiments: scoring every op of the scoped model, embedding
 * retrieval for unscoped requests, labeled refs, vocabularies, the safe
 * optional-field gate and the no-action gate. Dev sets: the 30-item seed
 * set and `eval/dev-extra.json`; held-out-2 is fetched at run time.
 */
import {
  argsGrammar,
  gateOptional,
  labelRefCandidates,
  mapRefLabels,
  refEnumValues,
  type GateMode,
} from "../../editors/knowledge-vault/chat/core/args-grammar.js";
import { fillArgsStep } from "../../editors/knowledge-vault/chat/core/args-step.js";
import { buildAction } from "../../editors/knowledge-vault/chat/core/envelope.js";
import { fillArgsMessages } from "../../editors/knowledge-vault/chat/core/generator.js";
import { loadGteEmbedder } from "../../editors/knowledge-vault/chat/core/gte-embedder.js";
import type { LlmClient } from "../../editors/knowledge-vault/chat/core/llm-client.js";
import {
  combinedNoAction,
  embeddingGateScore,
  NO_ACTION_EXEMPLARS,
  scoreChangeGate,
} from "../../editors/knowledge-vault/chat/core/no-action-gate.js";
import { OP_DESCRIPTIONS } from "../../editors/knowledge-vault/chat/core/op-descriptions.js";
import {
  createEmbeddingRetriever,
  dot,
  minMax,
  rankModels,
  reciprocalRankFusion,
  type EmbeddingRetriever,
} from "../../editors/knowledge-vault/chat/core/op-embeddings.js";
import {
  buildModelSchema,
  leafFields,
  type CatalogEntry,
} from "../../editors/knowledge-vault/chat/core/op-catalog.js";
import { createOpRetriever } from "../../editors/knowledge-vault/chat/core/op-retriever.js";
import {
  argmax,
  fuse,
  NONE_KEY,
  pickFromRequests,
  rotationOffsets,
  scoreOptions,
  type AnswerFormat,
  type LabelStyle,
  type ScoreCache,
  type ScoredRequest,
} from "../../editors/knowledge-vault/chat/core/op-scorer.js";
import { VOCABULARIES } from "../../editors/knowledge-vault/chat/core/vocabularies.js";
import devExtra from "./eval/dev-extra.json" with { type: "json" };
import { loadItems, scoreArgs, type EvalItem } from "./r5.js";

type Json = Record<string, unknown>;
type Desc = "own" | "override";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pct(n: number, d: number): number | null {
  return d === 0 ? null : Math.round((1000 * n) / d) / 10;
}

function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(
    s[Math.max(0, Math.min(s.length - 1, Math.ceil(q * s.length) - 1))],
  );
}

function status(text: string) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

/* ------------------------------------------------------------------ */
/* Catalog, retrievers                                                  */
/* ------------------------------------------------------------------ */

interface R6Catalog {
  catalog: CatalogEntry[];
  get(key: string): CatalogEntry;
  ops(docType: string): CatalogEntry[];
  bm25: ReturnType<typeof createOpRetriever>;
}

const catalogs = new Map<Desc, R6Catalog>();

export async function r6Catalog(desc: Desc): Promise<R6Catalog> {
  const hit = catalogs.get(desc);
  if (hit) return hit;
  const { buildVaultCatalog } =
    await import("../../editors/knowledge-vault/chat/core/catalog-models.js");
  const catalog = buildVaultCatalog({
    vocabularies: VOCABULARIES,
    descriptionOverrides: desc === "override" ? OP_DESCRIPTIONS : undefined,
  });
  const out: R6Catalog = {
    catalog,
    get(key) {
      const e = catalog.find((c) => c.key === key);
      if (!e) throw new Error(`missing ${key}`);
      return e;
    },
    ops: (docType) =>
      catalog.filter((c) => c.docType === docType && c.scope === "global"),
    bm25: createOpRetriever(catalog),
  };
  catalogs.set(desc, out);
  return out;
}

let embedderLoad: { loadMs: number } | null = null;
let exemplarVecs: Float32Array[] | null = null;

/** Similarities of `query` to the no-action exemplars (embedded once). */
async function exemplarSims(query: string): Promise<number[]> {
  const emb = await loadGteEmbedder({
    localModelPath: "/models/",
    wasmPaths: "/ort/",
  });
  exemplarVecs ??= await emb.embed(NO_ACTION_EXEMPLARS);
  const [q] = await emb.embed([query]);
  return exemplarVecs.map((v) => dot(q, v));
}
const embRetrievers = new Map<Desc, EmbeddingRetriever>();

/** gte-small over op descriptions (always `OP_DESCRIPTIONS`), lazily. */
async function embRetriever(): Promise<EmbeddingRetriever> {
  const hit = embRetrievers.get("override");
  if (hit) return hit;
  const emb = await loadGteEmbedder({
    localModelPath: "/models/",
    wasmPaths: "/ort/",
  });
  embedderLoad = { loadMs: emb.loadMs };
  const { catalog } = await r6Catalog("own");
  const r = createEmbeddingRetriever(catalog, emb.embed, OP_DESCRIPTIONS);
  embRetrievers.set("override", r);
  return r;
}

/* ------------------------------------------------------------------ */
/* Items                                                                */
/* ------------------------------------------------------------------ */

export type R6Set =
  | "dev"
  | "devx"
  | "devna"
  | "h2"
  | "h2na"
  | "h2multi"
  /** Round 8: held-out-1 (round 5's set), labeled refs like held-out-2. */
  | "h1"
  | "h1na"
  /** Round 9: held-out-3 (blind; same schema as held-out-2). */
  | "h3"
  | "h3na"
  | "h3multi"
  /** Round 10: held-out-4 (blind; same schema as held-out-3). */
  | "h4"
  | "h4na"
  | "h4multi";

export interface R6Item extends EvalItem {
  set: R6Set;
  style?: string;
  difficulty?: string;
  /** Multi-action items: the expected op sequence. */
  expectedOps?: string[];
}

interface RawItem {
  id: string;
  utterance: string;
  style?: string;
  difficulty?: string;
  context: {
    docType: string;
    refCandidates?: Record<string, { id: string; label?: string }[]>;
  };
  expected?:
    | {
        op: string;
        args?: Json;
        ambiguousArgs?: Json;
        refArgs?: Json;
        argMatch?: Record<string, string>;
        requiredPresent?: string[];
      }
    | { op: string }[];
  requiredPresent?: string[];
}

interface RawFile {
  items: RawItem[];
  noAction: RawItem[];
  multiAction?: RawItem[];
}

function fromRaw(set: R6Set, it: RawItem): R6Item {
  const exp = it.expected;
  const base = {
    set,
    id: it.id,
    utterance: it.utterance,
    docType: it.context.docType,
    style: it.style,
    difficulty: it.difficulty,
    refCandidates: labelRefCandidates(it.context.refCandidates ?? {}),
  };
  if (Array.isArray(exp)) {
    return { ...base, expectedOp: null, expectedOps: exp.map((e) => e.op) };
  }
  if (!exp) return { ...base, expectedOp: null };
  return {
    ...base,
    expectedOp: exp.op,
    args: exp.args,
    ambiguousArgs: exp.ambiguousArgs,
    refArgs: exp.refArgs,
    argMatch: exp.argMatch,
    requiredPresent: exp.requiredPresent ?? it.requiredPresent,
  };
}

const heldoutFiles = new Map<string, Promise<RawFile>>();

/** A held-out file, fetched at run time (never bundled). */
function heldoutFile(name: string): Promise<RawFile> {
  let f = heldoutFiles.get(name);
  if (!f) {
    f = fetch(`./eval/${name}`).then(async (res) => {
      if (!res.ok) throw new Error(`${name}: ${res.status}`);
      return (await res.json()) as RawFile;
    });
    heldoutFiles.set(name, f);
  }
  return f;
}

function h2(): Promise<RawFile> {
  return heldoutFile("heldout2-eval.json");
}

export async function loadR6(set: R6Set): Promise<R6Item[]> {
  if (set === "dev") {
    return loadItems("dev").map((i) => ({ ...i, set, style: "dev" }));
  }
  if (set === "devx" || set === "devna") {
    const f = devExtra as unknown as RawFile;
    const arr = set === "devx" ? f.items : f.noAction;
    return arr.map((i) => fromRaw(set, { style: "dev", ...i }));
  }
  if (set === "h1" || set === "h1na") {
    const f1 = await heldoutFile("heldout-eval.json");
    return (set === "h1" ? f1.items : f1.noAction).map((i) => fromRaw(set, i));
  }
  if (set === "h3" || set === "h3na" || set === "h3multi") {
    const f3 = await heldoutFile("heldout3-eval.json");
    const a3 =
      set === "h3" ? f3.items : set === "h3na" ? f3.noAction : f3.multiAction;
    return (a3 ?? []).map((i) => fromRaw(set, i));
  }
  if (set === "h4" || set === "h4na" || set === "h4multi") {
    const f4 = await heldoutFile("heldout4-eval.json");
    const a4 =
      set === "h4" ? f4.items : set === "h4na" ? f4.noAction : f4.multiAction;
    return (a4 ?? []).map((i) => fromRaw(set, i));
  }
  const f = await h2();
  const arr =
    set === "h2"
      ? f.items
      : set === "h2na"
        ? f.noAction
        : (f.multiAction ?? []);
  return arr.map((i) => fromRaw(set, i));
}

async function loadSets(sets: R6Set[]): Promise<R6Item[]> {
  const out: R6Item[] = [];
  for (const s of sets) out.push(...(await loadR6(s)));
  return out;
}

/** Counts and accuracy split by style and by style × difficulty. */
export function splits(
  rows: Json[],
  ok: (r: Json) => boolean | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (k: string, r: Json) => {
    const v = ok(r);
    if (v === null) return;
    const [n, d] = (out[k] ?? "0/0").split("/").map(Number);
    out[k] = `${n + (v ? 1 : 0)}/${d + 1}`;
  };
  for (const r of rows) {
    add("all", r);
    add(`style=${String(r.style)}`, r);
    add(`${String(r.style)}/${String(r.difficulty)}`, r);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Retrieval (no LLM)                                                   */
/* ------------------------------------------------------------------ */

function rankOf(keys: string[], want: string | null): number | null {
  if (!want) return null;
  const i = keys.indexOf(want);
  return i === -1 ? null : i + 1;
}

/**
 * Recall@k of BM25, gte-small embeddings and their RRF fusion, unscoped
 * (all global ops) and scoped, plus model routing by the best op hit.
 */
export async function r6Retrieval(o: { sets: R6Set[] }): Promise<Json> {
  const { bm25, catalog } = await r6Catalog("own");
  const emb = await embRetriever();
  const prep = await emb.prepare();
  const items = (await loadSets(o.sets)).filter((i) => i.expectedOp);
  const nGlobal = catalog.filter((c) => c.scope === "global").length;
  const rows: Json[] = [];
  for (const [n, it] of items.entries()) {
    status(`r6 retrieval ${n + 1}/${items.length}`);
    const b = bm25
      .retrieve(it.utterance, { k: nGlobal })
      .map((h) => h.entry.key);
    const { hits, embedMs } = await emb.retrieve(it.utterance);
    const e = hits.map((h) => h.entry.key);
    const hy = reciprocalRankFusion([e, b]).map((x) => x.key);
    const bs = bm25
      .retrieve(it.utterance, { k: 99, docType: it.docType })
      .map((h) => h.entry.key);
    const es = hits
      .filter((h) => h.entry.docType === it.docType)
      .map((h) => h.entry.key);
    const models = rankModels(hits);
    rows.push({
      id: it.id,
      set: it.set,
      style: it.style,
      difficulty: it.difficulty,
      expectedOp: it.expectedOp,
      rank: {
        bm25: rankOf(b, it.expectedOp),
        emb: rankOf(e, it.expectedOp),
        hybrid: rankOf(hy, it.expectedOp),
        bm25Scoped: rankOf(bs, it.expectedOp),
        embScoped: rankOf(es, it.expectedOp),
      },
      bm25AllZeroScoped: bm25
        .retrieve(it.utterance, { k: 99, docType: it.docType })
        .every((h) => h.score === 0),
      modelRank: rankOf(models, it.docType),
      top5: { bm25: b.slice(0, 5), emb: e.slice(0, 5), hybrid: hy.slice(0, 5) },
      embedMs: Math.round(embedMs),
    });
  }
  const recall = (name: string, k: number) => {
    const hit = rows.filter((r) => {
      const v = (r.rank as Record<string, number | null>)[name];
      return v !== null && v <= k;
    }).length;
    return `${hit}/${rows.length} (${pct(hit, rows.length)}%)`;
  };
  const summary: Json = {
    sets: o.sets,
    n: rows.length,
    embedderLoadMs: embedderLoad ? Math.round(embedderLoad.loadMs) : null,
    opEmbedMs: Math.round(prep.wallMs),
    queryEmbedMedianMs: quantile(
      rows.map((r) => r.embedMs as number),
      0.5,
    ),
    queryEmbedP90Ms: quantile(
      rows.map((r) => r.embedMs as number),
      0.9,
    ),
    bm25AllZeroScoped: rows.filter((r) => r.bm25AllZeroScoped).length,
  };
  for (const name of ["bm25", "emb", "hybrid"])
    for (const k of [1, 3, 5, 10]) summary[`${name}@${k}`] = recall(name, k);
  for (const name of ["bm25Scoped", "embScoped"])
    for (const k of [1, 5]) summary[`${name}@${k}`] = recall(name, k);
  const m = (k: number) =>
    rows.filter((r) => r.modelRank !== null && (r.modelRank as number) <= k)
      .length;
  summary["model@1"] = `${m(1)}/${rows.length}`;
  summary["model@2"] = `${m(2)}/${rows.length}`;
  summary.byStyle = {
    "emb@5": splits(rows, (r) => {
      const v = (r.rank as Record<string, number | null>).emb;
      return v !== null && v <= 5;
    }),
    "hybrid@5": splits(rows, (r) => {
      const v = (r.rank as Record<string, number | null>).hybrid;
      return v !== null && v <= 5;
    }),
    "bm25@5": splits(rows, (r) => {
      const v = (r.rank as Record<string, number | null>).bm25;
      return v !== null && v <= 5;
    }),
    "model@1": splits(rows, (r) => r.modelRank === 1),
  };
  return { summary, rows };
}

/* ------------------------------------------------------------------ */
/* Op scoring                                                           */
/* ------------------------------------------------------------------ */

export interface OpScoreConfig {
  format: AnswerFormat;
  style: LabelStyle;
  desc: Desc;
  /** Orderings scored (prefixes of rotationOffsets(n, 3)). */
  orders: number;
  /** Score the no-action answer too (ops format: `{"ops": []}`). */
  includeNone: boolean;
}

/** One cache per prompt configuration, shared across a session. */
const cfCaches = new Map<string, ScoreCache>();

function cacheFor(name: string): ScoreCache {
  let c = cfCaches.get(name);
  if (!c) {
    c = new Map();
    cfCaches.set(name, c);
  }
  return c;
}

function compactReqs(reqs: ScoredRequest[]) {
  return reqs.map((r) => ({
    key: r.key,
    off: r.offset,
    cf: r.contentFree,
    sum: Math.round(r.logprobs.reduce((s, x) => s + x, 0) * 1000) / 1000,
    n: r.logprobs.length,
    ms: Math.round(r.wallMs),
    cached: r.cached,
  }));
}

interface Picks {
  picks: Record<string, string | null>;
  wall: Record<string, number>;
  scores: Record<string, Record<string, number>>;
}

/**
 * Methods derived from one set of requests. `keys` are the candidates (and
 * NONE_KEY when scored); `aux` are optional fusion scores per candidate.
 */
function methods(
  reqs: ScoredRequest[],
  keys: string[],
  offsets: number[],
  aux: Record<string, number[]>,
): Picks {
  const out: Picks = { picks: {}, wall: {}, scores: {} };
  const actionKeys = keys.filter((k) => k !== NONE_KEY);
  // Retrieval-only picks (no LLM): the top candidate by each aux score.
  for (const [auxName, vals] of Object.entries(aux)) {
    out.picks[`top1-${auxName}`] = actionKeys[argmax(vals)] ?? null;
    out.wall[`top1-${auxName}`] = 0;
  }
  for (const agg of ["mean", "sum"] as const) {
    const variants: Record<string, { calibrated: boolean; offsets: number[] }> =
      {
        S1: { calibrated: false, offsets: [offsets[0]] },
        S2: { calibrated: true, offsets: [offsets[0]] },
      };
    if (offsets.length > 1)
      variants.S2o2 = { calibrated: true, offsets: offsets.slice(0, 2) };
    if (offsets.length > 2) variants.S3 = { calibrated: true, offsets };
    for (const [name, v] of Object.entries(variants)) {
      for (const withNone of keys.includes(NONE_KEY)
        ? [false, true]
        : [false]) {
        const ks = withNone ? keys : actionKeys;
        const label = `${name}-${agg}${withNone ? "+none" : ""}`;
        const p = pickFromRequests(
          reqs.filter((r) => withNone || r.key !== NONE_KEY),
          ks,
          { aggregate: agg, ...v },
        );
        out.picks[label] = p.key;
        out.wall[label] = p.wallMs;
        out.scores[label] = p.scores;
        if (agg !== "mean" || withNone) continue;
        for (const [auxName, vals] of Object.entries(aux)) {
          const llm = actionKeys.map((k) => p.scores[k]);
          const f = fuse(llm, vals, 5);
          out.picks[`${label}+${auxName}`] = actionKeys[argmax(f)] ?? null;
          out.wall[`${label}+${auxName}`] = p.wallMs;
        }
      }
    }
  }
  return out;
}

function summarizeOps(rows: Json[]): Json {
  const ms = Object.keys((rows[0]?.picks as Json | undefined) ?? {});
  const per: Json = {};
  for (const m of ms) {
    const pick = (r: Json) => (r.picks as Record<string, string | null>)[m];
    const want = (r: Json) => (r.expectedOp as string | null) ?? NONE_KEY;
    const action = rows.filter((r) => r.expectedOp);
    const inCand = action.filter((r) => r.inCandidates);
    const walls = rows.map((r) => (r.wall as Record<string, number>)[m]);
    per[m] = {
      acc: `${action.filter((r) => pick(r) === want(r)).length}/${action.length}`,
      accGivenIn: `${inCand.filter((r) => pick(r) === want(r)).length}/${inCand.length}`,
      noneOnAction: action.filter((r) => pick(r) === NONE_KEY).length,
      noneOnNoAction: `${rows.filter((r) => !r.expectedOp && pick(r) === NONE_KEY).length}/${rows.filter((r) => !r.expectedOp).length}`,
      medianMs: quantile(walls, 0.5),
      p90Ms: quantile(walls, 0.9),
      byStyle: splits(action, (r) => pick(r) === want(r)),
    };
  }
  return per;
}

/** Scoped: every global op of the item's model, calibrated (cached CF). */
export async function r6OpsScoped(
  c: LlmClient,
  o: OpScoreConfig & { sets: R6Set[]; withEmb: boolean },
): Promise<Json> {
  const cat = await r6Catalog(o.desc);
  const emb = o.withEmb ? await embRetriever() : null;
  const items = await loadSets(o.sets);
  const cache = cacheFor(`scoped:${o.format}:${o.style}:${o.desc}`);
  const rows: Json[] = [];
  const cfCost: Record<string, number> = {};
  for (const [n, it] of items.entries()) {
    status(`r6 scoped ${n + 1}/${items.length}`);
    const cands = cat.ops(it.docType);
    const keys = cands.map((e) => e.key);
    const offsets = rotationOffsets(cands.length, 3).slice(0, o.orders);
    const reqs = await scoreOptions(it.utterance, cands, {
      scoreText: c.scoreText,
      style: o.style,
      offsets,
      contentFree: true,
      includeNone: o.includeNone,
      format: o.format,
      cache,
    });
    for (const r of reqs)
      if (r.contentFree && !r.cached)
        cfCost[`${it.docType}@${r.offset}`] =
          (cfCost[`${it.docType}@${r.offset}`] ?? 0) + r.computeMs;
    const bm = cat.bm25.retrieve(it.utterance, { k: 99, docType: it.docType });
    const aux: Record<string, number[]> = {
      bm25: keys.map((k) => bm.find((h) => h.entry.key === k)?.score ?? 0),
    };
    let embedMs: number | null = null;
    if (emb) {
      const r = await emb.retrieve(it.utterance, { docType: it.docType });
      embedMs = r.embedMs;
      aux.emb = minMax(
        keys.map((k) => r.hits.find((h) => h.entry.key === k)?.score ?? 0),
      );
    }
    const allKeys = o.includeNone ? [...keys, NONE_KEY] : keys;
    const m = methods(reqs, allKeys, offsets, aux);
    rows.push({
      id: it.id,
      set: it.set,
      style: it.style,
      difficulty: it.difficulty,
      utterance: it.utterance,
      expectedOp: it.expectedOp,
      expectedOps: it.expectedOps ?? null,
      nCandidates: keys.length,
      inCandidates: it.expectedOp ? keys.includes(it.expectedOp) : null,
      embedMs,
      ...m,
      requests: compactReqs(reqs),
    });
  }
  return {
    summary: {
      config: o,
      n: rows.length,
      cfOneTimeMs: Object.fromEntries(
        Object.entries(cfCost).map(([k, v]) => [k, Math.round(v)]),
      ),
      methods: summarizeOps(rows),
    },
    rows,
  };
}

/**
 * Unscoped. `topk`: the retriever's top k ops, calibrated per request.
 * `route`: the embedding retriever's best model, then that model's full
 * op list as in scoped mode (cached CF).
 */
export async function r6OpsUnscoped(
  c: LlmClient,
  o: OpScoreConfig & {
    sets: R6Set[];
    method: "topk" | "route";
    retriever: "bm25" | "emb" | "hybrid";
    k: number;
  },
): Promise<Json> {
  const cat = await r6Catalog(o.desc);
  const emb = await embRetriever();
  const nGlobal = cat.catalog.filter((x) => x.scope === "global").length;
  const items = await loadSets(o.sets);
  const cache = cacheFor(`scoped:${o.format}:${o.style}:${o.desc}`);
  const rows: Json[] = [];
  for (const [n, it] of items.entries()) {
    status(`r6 unscoped ${n + 1}/${items.length}`);
    const { hits, embedMs } = await emb.retrieve(it.utterance);
    const e = hits.map((h) => h.entry.key);
    const b = cat.bm25
      .retrieve(it.utterance, { k: nGlobal })
      .map((h) => h.entry.key);
    let cands: CatalogEntry[];
    let routed: string | null = null;
    if (o.method === "route") {
      routed = rankModels(hits)[0] ?? null;
      cands = routed ? cat.ops(routed) : [];
    } else {
      const ranked =
        o.retriever === "emb"
          ? e
          : o.retriever === "bm25"
            ? b
            : reciprocalRankFusion([e, b]).map((x) => x.key);
      cands = ranked.slice(0, o.k).map((k) => cat.get(k));
    }
    const keys = cands.map((x) => x.key);
    const offsets = rotationOffsets(cands.length, 3).slice(0, o.orders);
    const reqs = await scoreOptions(it.utterance, cands, {
      scoreText: c.scoreText,
      style: o.style,
      offsets,
      contentFree: true,
      includeNone: o.includeNone,
      format: o.format,
      cache: o.method === "route" ? cache : undefined,
    });
    const allKeys = o.includeNone ? [...keys, NONE_KEY] : keys;
    const sims = keys.map(
      (k) => hits.find((h) => h.entry.key === k)?.score ?? 0,
    );
    const m = methods(reqs, allKeys, offsets, { emb: minMax(sims) });
    for (const name of Object.keys(m.wall)) m.wall[name] += embedMs;
    rows.push({
      id: it.id,
      set: it.set,
      style: it.style,
      difficulty: it.difficulty,
      utterance: it.utterance,
      expectedOp: it.expectedOp,
      routed,
      candidates: keys,
      inCandidates: it.expectedOp ? keys.includes(it.expectedOp) : null,
      embedMs: Math.round(embedMs),
      ...m,
      requests: compactReqs(reqs),
    });
  }
  const action = rows.filter((r) => r.expectedOp);
  return {
    summary: {
      config: o,
      n: rows.length,
      recall: `${action.filter((r) => r.inCandidates).length}/${action.length}`,
      recallByStyle: splits(action, (r) => r.inCandidates === true),
      methods: summarizeOps(rows),
    },
    rows,
  };
}

/* ------------------------------------------------------------------ */
/* No-action gate                                                       */
/* ------------------------------------------------------------------ */

export async function r6Gate(
  c: LlmClient,
  o: { sets: R6Set[] },
): Promise<Json> {
  const items = await loadSets(o.sets);
  const cache = cacheFor("gate");
  const rows: Json[] = [];
  for (const [n, it] of items.entries()) {
    status(`r6 gate ${n + 1}/${items.length}`);
    const g = await scoreChangeGate(it.utterance, it.docType, {
      scoreText: c.scoreText,
      cache,
    });
    rows.push({
      id: it.id,
      set: it.set,
      style: it.style,
      difficulty: it.difficulty,
      utterance: it.utterance,
      isNoAction: !it.expectedOp && !it.expectedOps,
      isMulti: Boolean(it.expectedOps),
      score: Math.round(g.score * 1000) / 1000,
      rawScore: Math.round(g.rawScore * 1000) / 1000,
      predictedNoAction: g.noAction,
      wallMs: Math.round(g.wallMs),
    });
  }
  const single = rows.filter((r) => !r.isMulti);
  const tp = single.filter((r) => r.isNoAction && r.predictedNoAction).length;
  const fp = single.filter((r) => !r.isNoAction && r.predictedNoAction).length;
  const fn = single.filter((r) => r.isNoAction && !r.predictedNoAction).length;
  const walls = rows.map((r) => r.wallMs as number);
  return {
    summary: {
      sets: o.sets,
      threshold: 0,
      noActionItems: single.filter((r) => r.isNoAction).length,
      actionItems: single.filter((r) => !r.isNoAction).length,
      tp,
      fp,
      fn,
      precision: pct(tp, tp + fp),
      recall: pct(tp, tp + fn),
      multiPredictedNoAction: rows.filter(
        (r) => r.isMulti && r.predictedNoAction,
      ).length,
      medianMs: quantile(walls, 0.5),
      p90Ms: quantile(walls, 0.9),
    },
    rows,
  };
}

/** Embedding gate: nearest no-action exemplar vs nearest (scoped) op. */
export async function r6GateEmb(o: { sets: R6Set[] }): Promise<Json> {
  const emb = await embRetriever();
  const items = await loadSets(o.sets);
  const rows: Json[] = [];
  for (const it of items) {
    const t0 = performance.now();
    const ex = await exemplarSims(it.utterance);
    const { hits } = await emb.retrieve(it.utterance, { docType: it.docType });
    const ms = performance.now() - t0;
    const score = embeddingGateScore(
      ex,
      hits.map((h) => h.score),
    );
    rows.push({
      id: it.id,
      set: it.set,
      style: it.style,
      difficulty: it.difficulty,
      utterance: it.utterance,
      isNoAction: !it.expectedOp && !it.expectedOps,
      isMulti: Boolean(it.expectedOps),
      score: Math.round(score * 1000) / 1000,
      predictedNoAction: score > 0,
      predictedCombined: combinedNoAction(it.utterance, score),
      wallMs: Math.round(ms),
    });
  }
  const single = rows.filter((r) => !r.isMulti);
  const tp = single.filter((r) => r.isNoAction && r.predictedNoAction).length;
  const fp = single.filter((r) => !r.isNoAction && r.predictedNoAction).length;
  const fn = single.filter((r) => r.isNoAction && !r.predictedNoAction).length;
  return {
    summary: {
      sets: o.sets,
      threshold: 0,
      tp,
      fp,
      fn,
      precision: pct(tp, tp + fp),
      recall: pct(tp, tp + fn),
      combined: (() => {
        const ctp = single.filter(
          (r) => r.isNoAction && r.predictedCombined,
        ).length;
        const cfp = single.filter(
          (r) => !r.isNoAction && r.predictedCombined,
        ).length;
        const cfn = single.filter(
          (r) => r.isNoAction && !r.predictedCombined,
        ).length;
        return {
          tp: ctp,
          fp: cfp,
          fn: cfn,
          precision: pct(ctp, ctp + cfp),
          recall: pct(ctp, ctp + cfn),
          fpByStyle: splits(
            single.filter((r) => !r.isNoAction),
            (r) => r.predictedCombined === true,
          ),
        };
      })(),
      multiPredictedNoAction: rows.filter(
        (r) => r.isMulti && r.predictedNoAction,
      ).length,
      multiCombinedNoAction: rows.filter(
        (r) => r.isMulti && r.predictedCombined,
      ).length,
      medianMs: quantile(
        rows.map((r) => r.wallMs as number),
        0.5,
      ),
    },
    rows,
  };
}

/* ------------------------------------------------------------------ */
/* Args (oracle op)                                                     */
/* ------------------------------------------------------------------ */

function zodOk(entry: CatalogEntry, args: Json): boolean {
  const refIds = Object.fromEntries(
    leafFields(entry.fields)
      .filter((f) => f.fieldClass === "ref-id")
      .map((f) => [f.path.join("."), f.list ? ["ref-1"] : "ref-1"]),
  );
  return buildAction(entry, args, {
    generateId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    actor: "ben",
    refIds,
  }).ok;
}

export interface ArgsConfig {
  /** `r5`: round-5 A1 (gate all, labels in the signature, no choices line). */
  mode: "r5" | "r6";
  gate: GateMode;
  scoreRefs: boolean;
  /** Also score the first required enum field when no ref is scored. */
  scoreEnums?: boolean;
  refAggregate: "mean" | "sum";
}

async function argsFor(
  c: LlmClient,
  it: R6Item,
  entry: CatalogEntry,
  o: ArgsConfig,
  cache: ScoreCache,
): Promise<Json> {
  const refs = it.refCandidates ?? {};
  if (o.mode === "r5") {
    const schema = gateOptional(
      buildModelSchema(entry, { refCandidates: refEnumValues(refs) }),
      it.utterance,
      "all",
      new Set(Object.keys(refs)),
    );
    const props = isRecord(schema.properties) ? schema.properties : {};
    if (Object.keys(props).length === 0)
      return { args: {}, raw: null, genMs: 0, refMs: 0, refCfMs: 0 };
    const grammar = argsGrammar(schema, it.utterance, { spans: true });
    const r = await c.completeJson(
      fillArgsMessages(it.utterance, entry, schema),
      { kind: "grammar", grammar },
      { temperature: 0, maxTokens: 192 },
    );
    return {
      args: isRecord(r.parsed) ? mapRefLabels(r.parsed, refs) : null,
      raw: r.text,
      genMs: r.wallMs,
      refMs: 0,
      refCfMs: 0,
    };
  }
  const r = await fillArgsStep(it.utterance, entry, refs, {
    completeJson: c.completeJson,
    scoreText: c.scoreText,
    gate: o.gate,
    scoreRefs: o.scoreRefs,
    scoreEnums: o.scoreEnums,
    refAggregate: o.refAggregate,
    cache,
  });
  return {
    args: r.args,
    raw: r.raw,
    error: r.error,
    genMs: r.genMs,
    refMs: r.refMs,
    refCfMs: r.refCfMs,
    refField: r.refField,
    refScores: r.refScores,
    gatedFields: Object.keys(
      isRecord(r.schema.properties) ? r.schema.properties : {},
    ),
    prompt: r.messages?.[1]?.content ?? null,
  };
}

export function scoreArgRow(it: R6Item, entry: CatalogEntry, got: Json): Json {
  const args = isRecord(got.args) ? got.args : null;
  const score = scoreArgs(it, args, Object.keys(it.refCandidates ?? {}));
  return { ...score, zodOk: args ? zodOk(entry, args) : null };
}

export function summarizeArgs(rows: Json[]): Json {
  const cnt = (k: string) => rows.filter((r) => r[k] === true).length;
  const scored = (k: string) =>
    rows.filter((r) => r[k] !== null && r[k] !== undefined).length;
  const f = (k: string) => `${cnt(k)}/${scored(k)}`;
  const called = rows.filter((r) => r.raw !== null);
  return {
    n: rows.length,
    exact: f("exact"),
    fieldsMatch: f("fieldsMatch"),
    withExtras: rows.filter(
      (r) => ((r.extras as string[] | undefined) ?? []).length > 0,
    ).length,
    requiredPresent: f("requiredPresent"),
    refExact: f("refExact"),
    zodOk: f("zodOk"),
    emptyArgs: rows.filter(
      (r) =>
        isRecord(r.args) &&
        Object.keys(r.args).length === 0 &&
        r.exact !== null,
    ).length,
    genMedianMs: quantile(
      called.map((r) => r.genMs as number),
      0.5,
    ),
    genP90Ms: quantile(
      called.map((r) => r.genMs as number),
      0.9,
    ),
    refMedianMs: quantile(
      rows.filter((r) => (r.refMs as number) > 0).map((r) => r.refMs as number),
      0.5,
    ),
    refP90Ms: quantile(
      rows.filter((r) => (r.refMs as number) > 0).map((r) => r.refMs as number),
      0.9,
    ),
    refCfMedianMs: quantile(
      rows
        .filter((r) => (r.refCfMs as number) > 0)
        .map((r) => r.refCfMs as number),
      0.5,
    ),
    exactByStyle: splits(rows, (r) => (r.exact as boolean | null) ?? null),
    refByStyle: splits(rows, (r) => (r.refExact as boolean | null) ?? null),
  };
}

export async function r6Args(
  c: LlmClient,
  o: ArgsConfig & { sets: R6Set[]; desc: Desc },
): Promise<Json> {
  const cat = await r6Catalog(o.desc);
  const items = (await loadSets(o.sets)).filter((i) => i.expectedOp);
  const cache = cacheFor("args-refs");
  const rows: Json[] = [];
  for (const [n, it] of items.entries()) {
    status(`r6 args ${n + 1}/${items.length}`);
    const entry = cat.get(it.expectedOp ?? "");
    let got: Json;
    try {
      got = await argsFor(c, it, entry, o, cache);
    } catch (err) {
      got = {
        args: null,
        raw: null,
        error: String(err),
        genMs: 0,
        refMs: 0,
        refCfMs: 0,
      };
    }
    rows.push({
      id: it.id,
      set: it.set,
      style: it.style,
      difficulty: it.difficulty,
      utterance: it.utterance,
      op: it.expectedOp,
      expected: { args: it.args ?? null, refArgs: it.refArgs ?? null },
      ...got,
      ...scoreArgRow(it, entry, got),
    });
  }
  return { summary: { config: o, ...summarizeArgs(rows) }, rows };
}

/* ------------------------------------------------------------------ */
/* End-to-end pipeline                                                  */
/* ------------------------------------------------------------------ */

export interface PipelineConfig {
  scoped: boolean;
  ops: OpScoreConfig;
  /** Name of the `methods()` pick used, e.g. `S3-mean+bm25`. */
  pick: string;
  noAction: "gate" | "ops-empty" | "none";
  unscoped?: {
    method: "topk" | "route";
    retriever: "bm25" | "emb" | "hybrid";
    k: number;
  };
  args: ArgsConfig;
}

/** Gate → op → args for every item; args are scored only on a correct op. */
export async function r6Pipeline(
  c: LlmClient,
  o: PipelineConfig & { sets: R6Set[] },
): Promise<Json> {
  const cat = await r6Catalog(o.ops.desc);
  const emb = await embRetriever();
  const nGlobal = cat.catalog.filter((x) => x.scope === "global").length;
  const items = await loadSets(o.sets);
  const opCache = cacheFor(
    `scoped:${o.ops.format}:${o.ops.style}:${o.ops.desc}`,
  );
  const gateCache = cacheFor("gate");
  const argCache = cacheFor("args-refs");
  const rows: Json[] = [];
  for (const [n, it] of items.entries()) {
    status(`r6 pipeline ${n + 1}/${items.length}`);
    const row: Json = {
      id: it.id,
      set: it.set,
      style: it.style,
      difficulty: it.difficulty,
      utterance: it.utterance,
      expectedOp: it.expectedOp,
      expectedOps: it.expectedOps ?? null,
    };
    let gateMs = 0;
    let gatedOut = false;
    if (o.noAction === "gate") {
      const g = await scoreChangeGate(it.utterance, it.docType, {
        scoreText: c.scoreText,
        cache: gateCache,
      });
      gateMs = g.wallMs;
      gatedOut = g.noAction;
      row.gateScore = Math.round(g.score * 1000) / 1000;
    }
    let pick: string | null = gatedOut ? NONE_KEY : null;
    let opMs = 0;
    let embedMs = 0;
    if (!gatedOut) {
      let cands: CatalogEntry[];
      let aux: Record<string, number[]> = {};
      let cache: ScoreCache | undefined = opCache;
      if (o.scoped) {
        cands = cat.ops(it.docType);
        const bm = cat.bm25.retrieve(it.utterance, {
          k: 99,
          docType: it.docType,
        });
        const r = await emb.retrieve(it.utterance, { docType: it.docType });
        embedMs = r.embedMs;
        aux = {
          bm25: cands.map(
            (e) => bm.find((h) => h.entry.key === e.key)?.score ?? 0,
          ),
          emb: minMax(
            cands.map(
              (e) => r.hits.find((h) => h.entry.key === e.key)?.score ?? 0,
            ),
          ),
        };
      } else {
        const u = o.unscoped ?? { method: "route", retriever: "emb", k: 5 };
        const r = await emb.retrieve(it.utterance);
        embedMs = r.embedMs;
        if (u.method === "route") {
          const routed = rankModels(r.hits)[0];
          row.routed = routed;
          cands = routed ? cat.ops(routed) : [];
        } else {
          const e = r.hits.map((h) => h.entry.key);
          const b = cat.bm25
            .retrieve(it.utterance, { k: nGlobal })
            .map((h) => h.entry.key);
          const ranked =
            u.retriever === "emb"
              ? e
              : u.retriever === "bm25"
                ? b
                : reciprocalRankFusion([e, b]).map((x) => x.key);
          cands = ranked.slice(0, u.k).map((k) => cat.get(k));
          cache = undefined;
        }
        aux = {
          emb: minMax(
            cands.map(
              (x) => r.hits.find((h) => h.entry.key === x.key)?.score ?? 0,
            ),
          ),
        };
      }
      const keys = cands.map((x) => x.key);
      row.inCandidates = it.expectedOp ? keys.includes(it.expectedOp) : null;
      const offsets = rotationOffsets(cands.length, 3).slice(0, o.ops.orders);
      const reqs = await scoreOptions(it.utterance, cands, {
        scoreText: c.scoreText,
        style: o.ops.style,
        offsets,
        contentFree: true,
        includeNone: o.ops.includeNone,
        format: o.ops.format,
        cache,
      });
      const allKeys = o.ops.includeNone ? [...keys, NONE_KEY] : keys;
      const m = methods(reqs, allKeys, offsets, aux);
      pick = m.picks[o.pick] ?? null;
      opMs = m.wall[o.pick] ?? 0;
      row.opScores = m.scores[o.pick.split("+")[0]] ?? null;
    }
    row.pick = pick;
    row.opCorrect = it.expectedOp
      ? pick === it.expectedOp
      : it.expectedOps
        ? null
        : pick === NONE_KEY;
    if (it.expectedOps) {
      row.multiFirstPlausible = pick !== null && it.expectedOps.includes(pick);
      row.multiFirstIsFirst = pick === it.expectedOps[0];
    }
    let argsMs = 0;
    if (pick && pick !== NONE_KEY) {
      const entry = cat.get(pick);
      try {
        const got = await argsFor(c, it, entry, o.args, argCache);
        argsMs = (got.genMs as number) + (got.refMs as number);
        row.args = got.args;
        row.argsRaw = got.raw;
        row.refCfMs = got.refCfMs;
        if (row.opCorrect === true)
          Object.assign(row, scoreArgRow(it, entry, got));
      } catch (err) {
        row.argsError = String(err);
      }
    }
    row.ms = {
      gate: Math.round(gateMs),
      embed: Math.round(embedMs),
      op: Math.round(opMs),
      args: Math.round(argsMs),
      total: Math.round(gateMs + embedMs + opMs + argsMs),
    };
    rows.push(row);
  }
  const action = rows.filter((r) => r.expectedOp);
  const na = rows.filter((r) => !r.expectedOp && !r.expectedOps);
  const multi = rows.filter((r) => r.expectedOps);
  const lat = (k: string) => {
    const xs = rows.map((r) => (r.ms as Record<string, number>)[k]);
    return { median: quantile(xs, 0.5), p90: quantile(xs, 0.9) };
  };
  const tp = na.filter((r) => r.pick === NONE_KEY).length;
  const fp = action.filter((r) => r.pick === NONE_KEY).length;
  return {
    summary: {
      config: o,
      n: rows.length,
      opAcc: `${action.filter((r) => r.opCorrect).length}/${action.length}`,
      opAccGivenIn: `${action.filter((r) => r.inCandidates && r.opCorrect).length}/${action.filter((r) => r.inCandidates).length}`,
      opByStyle: splits(action, (r) => r.opCorrect === true),
      argsGivenCorrectOp: summarizeArgs(action.filter((r) => r.opCorrect)),
      noAction: {
        tp,
        fn: na.length - tp,
        fp,
        precision: pct(tp, tp + fp),
        recall: pct(tp, na.length),
      },
      multi: {
        n: multi.length,
        none: multi.filter((r) => r.pick === NONE_KEY).length,
        firstPlausible: multi.filter((r) => r.multiFirstPlausible).length,
        firstIsFirst: multi.filter((r) => r.multiFirstIsFirst).length,
      },
      latency: {
        gate: lat("gate"),
        embed: lat("embed"),
        op: lat("op"),
        args: lat("args"),
        total: lat("total"),
      },
    },
    rows,
  };
}
