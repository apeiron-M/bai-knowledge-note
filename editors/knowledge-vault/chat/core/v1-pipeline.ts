/**
 * The v1 chat pipeline (round 6 decision, prompt format r6.1), shared by
 * the Chat tab and the harness: embed the utterance once; the no-action
 * gate (question rule OR embedding score > 0.04) sends it to the answer
 * path; otherwise gte-small's top op of the scoped model is taken (no
 * step-1 LLM call) and step 2 fills its args under the copy-span grammar
 * with label-scored refs (round 6 config A2).
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
import type { ScoreCache } from "./op-scorer.js";
import { PROMPT_FORMAT_VERSION } from "./prompt-format.js";

/** Step-2 settings of the v1 pipeline (round 6 A2). */
export const V1_ARGS = {
  gate: "safe",
  scoreRefs: true,
  scoreEnums: false,
  refAggregate: "mean",
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

/**
 * Catalog, precomputed op index and gte-small embedder, once per page.
 * Only the utterance is embedded at run time.
 */
export function loadV1Runtime(
  embedder: GteEmbedderOptions = {},
): Promise<V1Runtime> {
  runtime ??= (async (): Promise<V1Runtime> => {
    const catalog = buildRuntimeCatalog();
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

export interface V1Deps {
  runtime: Pick<V1Runtime, "index" | "embedQuery">;
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

interface V1Common {
  promptFormat: typeof PROMPT_FORMAT_VERSION;
  gate: V1Gate;
  /** The scoped model's ops by similarity, best first. */
  hits: RetrievedOp[];
  embedMs: number;
}

export type V1Result =
  | (V1Common & { kind: "no-action" })
  | (V1Common & {
      kind: "action";
      entry: CatalogEntry;
      step2: ArgsStepResult;
    });

/**
 * Utterance → no-action, or the scoped model's top op with its args
 * (labels already mapped to ids). `refCandidates` gives the document's
 * referenceable items for the chosen op, by dotted path.
 */
export async function runV1(
  utterance: string,
  docType: string,
  refCandidates: (entry: CatalogEntry) => RefCandidates,
  deps: V1Deps,
): Promise<V1Result> {
  const t0 = performance.now();
  const q = await deps.runtime.embedQuery(utterance);
  const embedMs = performance.now() - t0;
  const hits = deps.runtime.index.rankOps(q, docType);
  const score = embeddingGateScore(
    deps.runtime.index.exemplarSims(q),
    hits.map((h) => h.score),
  );
  const noAction = combinedNoAction(utterance, score) || hits.length === 0;
  const common: V1Common = {
    promptFormat: PROMPT_FORMAT_VERSION,
    gate: { score, question: looksLikeQuestion(utterance), noAction },
    hits,
    embedMs,
  };
  if (noAction) return { ...common, kind: "no-action" };
  const entry = hits[0].entry;
  const step2 = await fillArgsStep(utterance, entry, refCandidates(entry), {
    completeJson: deps.completeJson,
    scoreText: deps.scoreText,
    cache: deps.cache,
    ...V1_ARGS,
  });
  return { ...common, kind: "action", entry, step2 };
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
