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
      const transformers = await import("@huggingface/transformers");

      // Serve model files from this package's own dist/ instead of
      // huggingface.co. The deployed switchboard's network policy
      // blocks HF, but the same CDN that delivered our JS modules also
      // serves the bundled `models/` directory. We compute the URL
      // from import.meta.url with string ops (rather than `new URL()`)
      // so rolldown's `resolveNewUrlToAsset` doesn't try to bundle
      // `models/` as a build-time asset import.
      //
      // build.ts copies `models/` into both `dist/browser/` and
      // `dist/node/`. The embedder ends up bundled into a chunk at
      // `dist/<platform>/<chunk>.mjs`, so `./models/` resolves to
      // `dist/<platform>/models/`.
      const moduleUrl = import.meta.url;
      const moduleDir = moduleUrl.slice(0, moduleUrl.lastIndexOf("/") + 1);
      const modelHost = `${moduleDir}models/`;
      transformers.env.allowLocalModels = false;
      transformers.env.allowRemoteModels = true;
      transformers.env.remoteHost = modelHost;
      transformers.env.remotePathTemplate = "{model}/";
      transformers.env.useBrowserCache = false;

      const ext = await transformers.pipeline(
        "feature-extraction",
        "Supabase/gte-small",
        { dtype: "q8" },
      );
      extractor = ext as FeatureExtractionPipeline;
      loading = null;
      console.log(
        `[Embedder] Model loaded: Supabase/gte-small (q8) from ${modelHost}`,
      );
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
