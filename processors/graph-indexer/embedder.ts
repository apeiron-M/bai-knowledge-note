import {
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";

let extractor: FeatureExtractionPipeline | null = null;
let loading: Promise<FeatureExtractionPipeline> | null = null;

export async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;

  // Prevent concurrent loads — share the same promise
  if (!loading) {
    loading = pipeline("feature-extraction", "Supabase/gte-small", {
      dtype: "q8",
    }).then((ext) => {
      extractor = ext as FeatureExtractionPipeline;
      loading = null;
      console.log("[Embedder] Model loaded: Supabase/gte-small (q8)");
      return extractor;
    });
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
