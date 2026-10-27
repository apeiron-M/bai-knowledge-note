/**
 * The v1 chat pipeline (prompt format r6.1), shared by the Chat tab and the
 * harness. The default is round 9's R2c, the best measured setup with the
 * round-8 LoRA (held-out-3 85.9% op, held-out-4 80.8%):
 *
 * 1. step 1: the model picks one op key, or `{"ops": []}` (no change), from
 *    every global op of the document's model in catalog order, under the
 *    alternation grammar of those answers. No no-action pre-gate and no
 *    retrieval: the embedding is not on the decision path, so it is skipped;
 * 2. step 2 fills that op's args under the copy-span grammar with
 *    label-scored refs (round 6 config A2).
 *
 * The round 6/7 pipeline (G3 gate, then gte-small's top op with no step-1
 * model call) and round 9's other candidate lists stay behind `step1`.
 */
import { fillArgsStep, type ArgsStepResult } from "./args-step.js";
import { buildRuntimeCatalog } from "./catalog-models.js";
import { buildAction, type EnvelopeContext } from "./envelope.js";
import { loadGteEmbedder, type GteEmbedderOptions } from "./gte-embedder.js";
import type { CompleteJson, ScoreText } from "./llm-client.js";
import {
  combinedNoAction,
  embeddingGateScore,
  looksLikeQuestion,
} from "./no-action-gate.js";
import type { CatalogEntry } from "./op-catalog.js";
import {
  createOpEmbeddingIndex,
  loadOpEmbeddingAsset,
  type OpEmbeddingIndex,
} from "./op-embedding-index.js";
import type { RetrievedOp } from "./op-retriever.js";
import {
  NONE_KEY,
  scoringMessages,
  toOptions,
  type ScoreCache,
} from "./op-scorer.js";
import { PROMPT_FORMAT_VERSION } from "./prompt-format.js";
import {
  step1Candidates,
  step1CandidatesLabel,
  step1Grammar,
  step1Pick,
  V1_STEP1,
  type Step1Candidates,
} from "./step1-candidates.js";

/** Step-2 settings of the v1 pipeline (round 6 A2). */
export const V1_ARGS = {
  gate: "safe",
  // X6: with the LoRA, ref labels scored by calibrated likelihood lose to
  // plain constrained generation (dev+val refs 123/130 vs 129/130; the
  // uncalibrated score picks exactly what generation picks), and scoring
  // costs ~2 requests per label.
  scoreRefs: false,
  scoreEnums: false,
  refAggregate: "mean",
  requireNamed: true,
  fixNamedEnums: true,
} as const;

export type RefCandidates = Record<
  string,
  { id: string; label?: string | null }[]
>;

export interface V1Runtime {
  catalog: CatalogEntry[];
  index: OpEmbeddingIndex;
  /** Embeds one utterance (L2-normalized). */
  embedQuery: (text: string) => Promise<Float32Array>;
  /** Embedder import + model load of the first load in this page, ms. */
  embedderLoadMs: number;
}

let runtime: Promise<V1Runtime> | null = null;
let catalogMemo: CatalogEntry[] | null = null;

/** The runtime catalog, built once per page (all the R2c default needs). */
export function v1Catalog(): CatalogEntry[] {
  catalogMemo ??= buildRuntimeCatalog();
  return catalogMemo;
}

/**
 * Catalog, precomputed op index and gte-small embedder, once per page.
 * Only the utterance is embedded at run time.
 */
export function loadV1Runtime(
  embedder: GteEmbedderOptions = {},
): Promise<V1Runtime> {
  runtime ??= (async (): Promise<V1Runtime> => {
    const catalog = v1Catalog();
    const [asset, emb] = await Promise.all([
      loadOpEmbeddingAsset(),
      loadGteEmbedder(embedder),
    ]);
    return {
      catalog,
      index: createOpEmbeddingIndex(catalog, asset),
      embedQuery: async (text) => (await emb.embed([text]))[0],
      embedderLoadMs: emb.loadMs,
    };
  })().catch((err: unknown) => {
    runtime = null;
    throw err;
  });
  return runtime;
}

/**
 * How the op is chosen. `model`: a step-1 model call over `candidates`
 * (round 8/9), with the G3 gate in front when `preGate`. `embedding-top1`:
 * the round 6/7 pipeline, G3 gate then gte-small's top scoped op.
 */
export type V1Step1 =
  | { kind: "model"; candidates: Step1Candidates; preGate: boolean }
  | { kind: "embedding-top1" };

/** The default: round 9 R2c (all scoped ops, catalog order, no pre-gate). */
export const V1_DEFAULT_STEP1: V1Step1 = {
  kind: "model",
  candidates: V1_STEP1,
  preGate: false,
};

/** The round 6/7 pipeline, kept as an explicit option. */
export const V1_EMBEDDING_TOP1: V1Step1 = { kind: "embedding-top1" };

export interface V1Options {
  step1?: V1Step1;
  /** Step-2 optional fields the safe gate never drops (round 9 R5). */
  alwaysOffer?: readonly string[];
}

/** A short name for results and the UI, e.g. "model:scoped-all-catalog". */
export function v1Step1Label(step1: V1Step1): string {
  if (step1.kind === "embedding-top1") return "embedding-top1+gate";
  return `model:${step1CandidatesLabel(step1.candidates)}${step1.preGate ? "+gate" : ""}`;
}

/** Whether a config needs the utterance embedded (gate or ranked list). */
export function v1NeedsEmbedding(step1: V1Step1): boolean {
  return (
    step1.kind === "embedding-top1" ||
    step1.preGate ||
    !(
      step1.candidates.mode === "scoped-all" &&
      step1.candidates.order === "catalog"
    )
  );
}

export interface V1Deps {
  /** `index` and `embedQuery` are needed only when the config embeds. */
  runtime: Pick<V1Runtime, "catalog"> &
    Partial<Pick<V1Runtime, "index" | "embedQuery">>;
  completeJson: CompleteJson;
  scoreText: ScoreText;
  /** Content-free ref-scoring requests, reused across utterances. */
  cache?: ScoreCache;
}

export interface V1Gate {
  /** Best exemplar similarity minus best op similarity. */
  score: number;
  question: boolean;
  noAction: boolean;
}

export interface V1Step1Result {
  /** The keys the model chose among, in prompt order. */
  candidates: string[];
  raw: string;
  /** An op key, or `NONE_KEY` for `{"ops": []}`. */
  pick: string;
  ms: number;
}

interface V1Common {
  promptFormat: typeof PROMPT_FORMAT_VERSION;
  pipeline: string;
  /** The G3 gate, when the config runs it. */
  gate: V1Gate | null;
  /** The scoped model's ops by similarity, best first (empty if not embedded). */
  hits: RetrievedOp[];
  embedMs: number;
  /** The step-1 model call, when the config makes one. */
  step1: V1Step1Result | null;
}

export type V1NoActionReason = "gate" | "model" | "no-ops";

export type V1Result =
  | (V1Common & { kind: "no-action"; reason: V1NoActionReason })
  | (V1Common & {
      kind: "action";
      entry: CatalogEntry;
      step2: ArgsStepResult;
    });

/**
 * Utterance → no-action, or one op of `docType`'s model with its args
 * (labels already mapped to ids). `refCandidates` gives the document's
 * referenceable items for the chosen op, by dotted path.
 */
export async function runV1(
  utterance: string,
  docType: string,
  refCandidates: (entry: CatalogEntry) => RefCandidates,
  deps: V1Deps,
  options: V1Options = {},
): Promise<V1Result> {
  const cfg = options.step1 ?? V1_DEFAULT_STEP1;
  const { catalog } = deps.runtime;
  let hits: RetrievedOp[] = [];
  let gate: V1Gate | null = null;
  let embedMs = 0;
  if (v1NeedsEmbedding(cfg)) {
    const { index, embedQuery } = deps.runtime;
    if (!index || !embedQuery)
      throw new Error(`${v1Step1Label(cfg)} needs the gte-small runtime`);
    const t0 = performance.now();
    const q = await embedQuery(utterance);
    embedMs = performance.now() - t0;
    hits = index.rankOps(q, docType);
    const score = embeddingGateScore(
      index.exemplarSims(q),
      hits.map((h) => h.score),
    );
    gate = {
      score,
      question: looksLikeQuestion(utterance),
      noAction: combinedNoAction(utterance, score) || hits.length === 0,
    };
  }
  const common: Omit<V1Common, "step1"> = {
    promptFormat: PROMPT_FORMAT_VERSION,
    pipeline: v1Step1Label(cfg),
    gate,
    hits,
    embedMs,
  };
  const gated = cfg.kind === "embedding-top1" || cfg.preGate;
  if (gated && gate?.noAction)
    return { ...common, step1: null, kind: "no-action", reason: "gate" };

  let entry: CatalogEntry;
  let step1: V1Step1Result | null = null;
  if (cfg.kind === "embedding-top1") entry = hits[0].entry;
  else {
    const cands = step1Candidates(cfg.candidates, {
      scopedHits: hits,
      catalog,
      docType,
    });
    if (cands.length === 0)
      return { ...common, step1: null, kind: "no-action", reason: "no-ops" };
    const keys = cands.map((c) => c.key);
    const t1 = performance.now();
    const r = await deps.completeJson(
      scoringMessages(utterance, toOptions(cands, "key"), "ops"),
      { kind: "grammar", grammar: step1Grammar(cands) },
      { temperature: 0, maxTokens: 64 },
    );
    const pick = step1Pick(r.parsed, keys);
    if (pick === null)
      throw new Error(`step 1 gave no listed op: ${JSON.stringify(r.text)}`);
    step1 = { candidates: keys, raw: r.text, pick, ms: performance.now() - t1 };
    if (pick === NONE_KEY)
      return { ...common, step1, kind: "no-action", reason: "model" };
    const picked = cands.find((c) => c.key === pick);
    if (!picked) throw new Error(`unknown step-1 pick ${pick}`);
    entry = picked;
  }
  const step2 = await fillArgsStep(utterance, entry, refCandidates(entry), {
    completeJson: deps.completeJson,
    scoreText: deps.scoreText,
    cache: deps.cache,
    ...V1_ARGS,
    alwaysOffer: options.alwaysOffer ?? [],
  });
  return { ...common, step1, kind: "action", entry, step2 };
}

/** The dispatchable action for a v1 result, or why there is none. */
export function v1Action(
  result: Extract<V1Result, { kind: "action" }>,
  ctx: EnvelopeContext,
): ReturnType<typeof buildAction> | { ok: false; error: string } {
  if (!result.step2.args)
    return { ok: false, error: result.step2.error ?? "no arguments" };
  return buildAction(result.entry, result.step2.args, ctx);
}
