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
      // Probe huggingface.co reachability so a network failure shows up as
      // a clear log line instead of the cryptic "Unable to get model file
      // path or buffer" that transformers throws further down the stack.
      try {
        const probe = await fetch(
          "https://huggingface.co/Supabase/gte-small/resolve/main/config.json",
          { method: "HEAD" },
        );
        console.log(
          `[Embedder] HF probe: ${probe.status} ${probe.statusText}`,
        );
      } catch (err) {
        console.error(
          "[Embedder] HF probe failed — container egress likely blocked",
          err instanceof Error ? `${err.name}: ${err.message}` : err,
        );
      }

      const transformers = await import("@huggingface/transformers");
      // Skip the local-file lookup (the web bundle in Node defaults
      // `allowLocalModels: true`) and the IndexedDB/file cache layer.
      transformers.env.allowLocalModels = false;
      transformers.env.useBrowserCache = false;

      const ext = await transformers.pipeline(
        "feature-extraction",
        "Supabase/gte-small",
        {
          dtype: "q8",
          progress_callback: (info: {
            status: string;
            file?: string;
            progress?: number;
          }) => {
            if (info.status === "initiate" || info.status === "download") {
              console.log(`[Embedder] ${info.status}: ${info.file ?? ""}`);
            } else if (
              info.status === "progress" &&
              info.progress &&
              info.progress % 25 < 1
            ) {
              console.log(
                `[Embedder] ${info.file}: ${Math.round(info.progress)}%`,
              );
            } else if (info.status === "done" || info.status === "ready") {
              console.log(`[Embedder] ${info.status}: ${info.file ?? ""}`);
            }
          },
        },
      );
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
