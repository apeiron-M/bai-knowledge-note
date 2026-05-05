import type { FeatureExtractionPipeline } from "@huggingface/transformers";

let extractor: FeatureExtractionPipeline | null = null;
let loading: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Lazy-load `@huggingface/transformers` at first use. The package bundles
 * onnxruntime-common (and on Node, calls into onnxruntime-node) at module
 * init — eager evaluation of those CJS requires crashes on deployed vetra
 * switchboards (HTTP CDN, no native binaries). Deferring the import to
 * first call keeps subgraph/processor registration unaffected; only the
 * embedding code path needs transformers present.
 */
export async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;

  // Prevent concurrent loads — share the same promise
  if (!loading) {
    loading = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      const ext = await pipeline("feature-extraction", "Supabase/gte-small", {
        dtype: "q8",
      });
      extractor = ext as FeatureExtractionPipeline;
      loading = null;
      console.log("[Embedder] Model loaded: Supabase/gte-small (q8)");
      return extractor;
    })();
  }

  return loading;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const ext = await getExtractor();
  const output = await ext(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

export function isEmbedderReady(): boolean {
  return extractor !== null;
}
