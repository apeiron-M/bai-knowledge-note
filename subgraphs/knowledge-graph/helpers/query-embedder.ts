/**
 * Server-side query embedding for the knowledgeGraph subgraph.
 *
 * Embeds a search string with the same model and quantization the headless
 * backfill uses (Supabase/gte-small, q8, 384-dim), so query vectors are
 * interchangeable with the stored note vectors. Measured on the Switchboard
 * host: ~500ms one-time model load, then 12–26ms per query.
 *
 * This exists so the BROWSER never has to load the model: Connect sends the
 * plain query text and the Switchboard does the embedding. Before this, the
 * knowledge-vault editor downloaded ~30MB of ONNX weights and ran inference
 * for every note on drive open, which is what made semantic search unusable
 * in the Connect app.
 *
 * The transformers import is deferred to first use for the same reason as
 * embedding-store.ts: module load must never fail on deployments where a
 * transitive dep is missing, or the subgraph fails to register at all.
 *
 * Model weights resolve from the HuggingFace hub cache. On a deployment with
 * no outbound network access, set TRANSFORMERS_CACHE (or bundle the weights
 * into dist and point env.localModelPath at them — see the embedding plan).
 */

type Extractor = (
  text: string,
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array }>;

let extractorPromise: Promise<Extractor> | null = null;
let unavailableReason: string | null = null;

async function loadExtractor(): Promise<Extractor> {
  const { pipeline } = await import("@huggingface/transformers");
  const extractor = (await pipeline("feature-extraction", "Supabase/gte-small", {
    dtype: "q8",
  })) as unknown as Extractor;
  return extractor;
}

/**
 * Embed a query string to a normalized 384-dim vector, or return null when
 * the model is unavailable (missing dep, no network for first download).
 * Callers fall back to keyword search on null rather than erroring.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  if (unavailableReason) return null;
  try {
    extractorPromise ??= loadExtractor();
    const extractor = await extractorPromise;
    const out = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(out.data);
  } catch (err) {
    // Remember the failure so every search afterwards skips the model path
    // instantly instead of re-timing-out; a restart retries.
    unavailableReason = err instanceof Error ? err.message : String(err);
    extractorPromise = null;
    console.warn(
      `[knowledgeGraph] query embedder unavailable, falling back to keyword search: ${unavailableReason}`,
    );
    return null;
  }
}
