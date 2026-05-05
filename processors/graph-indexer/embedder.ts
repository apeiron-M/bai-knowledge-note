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
      // Hide Node from `@huggingface/transformers` web bundle for the
      // duration of its module evaluation. Otherwise its IS_NODE_ENV
      // check (`process?.release?.name === "node"`) flips on, and the
      // ONNX loader requests a local file path for the model:
      //   getModelFile(..., apis.IS_NODE_ENV)  // ← passes return_path
      // which can't resolve against a remote URL — the call throws
      // "Unable to get model file path or buffer." We need the
      // browser-style buffer code path even though we're in Node.
      const originalRelease = process.release;
      Object.defineProperty(process, "release", {
        value: { ...originalRelease, name: "browser" },
        configurable: true,
        writable: true,
      });
      let transformers: typeof import("@huggingface/transformers");
      try {
        transformers = await import("@huggingface/transformers");
      } finally {
        Object.defineProperty(process, "release", {
          value: originalRelease,
          configurable: true,
          writable: true,
        });
      }

      // Serve model files from this package's own dist/ instead of
      // huggingface.co. The deployed switchboard's network policy
      // blocks HF, but the same CDN that delivered our JS modules also
      // serves the bundled `models/` directory. URL is computed via
      // string ops on import.meta.url so rolldown's
      // `resolveNewUrlToAsset` doesn't try to inline `models/` as a
      // build-time asset.
      const moduleUrl = import.meta.url;
      const moduleDir = moduleUrl.slice(0, moduleUrl.lastIndexOf("/") + 1);
      const modelHost = `${moduleDir}models/`;
      const wasmHost = `${moduleDir}wasm/`;
      transformers.env.allowLocalModels = false;
      transformers.env.allowRemoteModels = true;
      transformers.env.remoteHost = modelHost;
      transformers.env.remotePathTemplate = "{model}/";
      transformers.env.useBrowserCache = false;

      // Override onnxruntime-web's default wasmPaths (which point at
      // cdn.jsdelivr.net) — the deployed Node container can't do
      // `import("https://cdn.jsdelivr.net/...")`. build.ts copies these
      // helper files into dist/<platform>/wasm/.
      const onnx = (
        transformers.env.backends as { onnx?: { wasm?: Record<string, unknown> } }
      ).onnx;
      if (onnx?.wasm) {
        onnx.wasm.wasmPaths = {
          mjs: `${wasmHost}ort-wasm-simd-threaded.asyncify.mjs`,
          wasm: `${wasmHost}ort-wasm-simd-threaded.asyncify.wasm`,
        };
      }

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
