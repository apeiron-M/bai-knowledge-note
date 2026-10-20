/**
 * Semantic op retrieval (spike round 6). Each global op is embedded once
 * from its readable name, model and description; at query time only the
 * utterance is embedded, and ops are ranked by cosine similarity. The
 * embedder is injected (see `gte-embedder.ts`, loaded lazily), so this file
 * has no runtime dependency and the ranking and fusion are pure.
 */
import type { CatalogEntry } from "./op-catalog.js";
import type { RetrievedOp } from "./op-retriever.js";

/** Embeds a batch of texts; vectors must be L2-normalized. */
export type EmbedTexts = (texts: string[]) => Promise<Float32Array[]>;

/**
 * The text an op is embedded under: `<op in words> (<model in words>):
 * <description>`. `descriptions` overrides the model's own text by key.
 */
export function opEmbeddingText(
  entry: Pick<CatalogEntry, "key" | "opName" | "model" | "description">,
  descriptions?: Record<string, string>,
): string {
  const words = entry.opName.toLowerCase().replace(/_/g, " ");
  const model = entry.model.replace(/-/g, " ");
  const desc = descriptions?.[entry.key] ?? entry.description;
  return desc ? `${words} (${model}): ${desc}` : `${words} (${model})`;
}

/** Dot product; equals cosine similarity for normalized vectors. */
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** Indices sorted by descending score; ties keep input order. */
export function rankIndices(scores: number[]): number[] {
  return scores
    .map((s, i) => ({ s, i }))
    .sort((x, y) => y.s - x.s || x.i - y.i)
    .map(({ i }) => i);
}

export interface EmbeddingRetrieveOptions {
  k?: number;
  docType?: string;
}

export interface EmbeddingRetriever {
  /** Embeds every op (once); later calls return the same promise. */
  prepare(): Promise<{ wallMs: number }>;
  /** Similarity of every (filtered) op to the query, ranked. */
  retrieve(
    query: string,
    opts?: EmbeddingRetrieveOptions,
  ): Promise<{ hits: RetrievedOp[]; embedMs: number }>;
}

export function createEmbeddingRetriever(
  catalog: CatalogEntry[],
  embed: EmbedTexts,
  descriptions?: Record<string, string>,
): EmbeddingRetriever {
  const docs = catalog.filter((e) => e.scope === "global");
  let vectors: Float32Array[] | null = null;
  let preparing: Promise<{ wallMs: number }> | null = null;
  const prepare = () => {
    preparing ??= (async () => {
      const t0 = performance.now();
      vectors = await embed(docs.map((d) => opEmbeddingText(d, descriptions)));
      return { wallMs: performance.now() - t0 };
    })();
    return preparing;
  };
  return {
    prepare,
    async retrieve(query, opts = {}) {
      await prepare();
      const t0 = performance.now();
      const [q] = await embed([query]);
      const embedMs = performance.now() - t0;
      const vs = vectors ?? [];
      const pool = docs
        .map((entry, i) => ({ entry, score: dot(q, vs[i]) }))
        .filter((h) => !opts.docType || h.entry.docType === opts.docType);
      const order = rankIndices(pool.map((h) => h.score));
      return {
        hits: order.slice(0, opts.k ?? pool.length).map((i) => pool[i]),
        embedMs,
      };
    },
  };
}

/**
 * Reciprocal rank fusion of several rankings of the same keys:
 * score(key) = Σ 1 / (c + rank), rank from 1. Keys missing from a ranking
 * get nothing from it. Ties keep the first ranking's order.
 */
export function reciprocalRankFusion(
  rankings: string[][],
  c = 60,
): { key: string; score: number }[] {
  const score = new Map<string, number>();
  const firstSeen: string[] = [];
  for (const ranking of rankings) {
    ranking.forEach((key, r) => {
      if (!score.has(key)) firstSeen.push(key);
      score.set(key, (score.get(key) ?? 0) + 1 / (c + r + 1));
    });
  }
  const order = rankIndices(firstSeen.map((k) => score.get(k) ?? 0));
  return order.map((i) => ({
    key: firstSeen[i],
    score: score.get(firstSeen[i]) ?? 0,
  }));
}

/**
 * Document types ranked by their best op similarity, for routing an
 * unscoped request to one model before scoring that model's ops.
 */
export function rankModels(hits: RetrievedOp[]): string[] {
  const best = new Map<string, number>();
  for (const h of hits) {
    const cur = best.get(h.entry.docType);
    if (cur === undefined || h.score > cur) best.set(h.entry.docType, h.score);
  }
  const types = [...best.keys()];
  return rankIndices(types.map((t) => best.get(t) ?? 0)).map((i) => types[i]);
}

/** Min–max normalize to [0, 1] (all zeros when the range is empty). */
export function minMax(xs: number[]): number[] {
  if (xs.length === 0) return [];
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return hi > lo ? xs.map((x) => (x - lo) / (hi - lo)) : xs.map(() => 0);
}
