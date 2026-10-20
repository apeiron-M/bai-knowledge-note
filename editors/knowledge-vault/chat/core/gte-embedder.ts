/**
 * Lazy loader for the committed `models/Supabase/gte-small` q8 embedder
 * (the graph indexer's model). In the browser it runs on the wasm backend,
 * so it does not compete with wllama for the GPU, and every file it needs
 * (model, tokenizer, onnxruntime-web's wasm) comes from the package origin:
 * Connect's CSP blocks transformers' default jsdelivr wasm. Nothing is
 * imported until the first call.
 */
import type { EmbedTexts } from "./op-embeddings.js";

export interface GteEmbedderOptions {
  /** URL prefix holding `Supabase/gte-small/` (default: `GTE_FILES`). */
  localModelPath?: string;
  /** onnxruntime-web wasm: a directory URL or `{ mjs, wasm }` (default `ORT_WASM_PATHS`). */
  wasmPaths?: string | { mjs: string; wasm: string };
}

/**
 * The vendored onnxruntime-web runtime, matching the version inside
 * transformers' web build (`vendor/onnxruntime-web/<version>/README.md`).
 */
export const ORT_WASM_PATHS = {
  mjs: new URL(
    "../../../../vendor/onnxruntime-web/1.26.0-dev.20260416-b7804b056c/ort-wasm-simd-threaded.asyncify.mjs",
    import.meta.url,
  ).href,
  wasm: new URL(
    "../../../../vendor/onnxruntime-web/1.26.0-dev.20260416-b7804b056c/ort-wasm-simd-threaded.asyncify.wasm",
    import.meta.url,
  ).href,
};

/** The committed model files, as URLs the bundler emits with the package. */
export const GTE_FILES: Record<string, string> = {
  "config.json": new URL(
    "../../../../models/Supabase/gte-small/config.json",
    import.meta.url,
  ).href,
  "tokenizer.json": new URL(
    "../../../../models/Supabase/gte-small/tokenizer.json",
    import.meta.url,
  ).href,
  "tokenizer_config.json": new URL(
    "../../../../models/Supabase/gte-small/tokenizer_config.json",
    import.meta.url,
  ).href,
  "special_tokens_map.json": new URL(
    "../../../../models/Supabase/gte-small/special_tokens_map.json",
    import.meta.url,
  ).href,
  "onnx/model_quantized.onnx": new URL(
    "../../../../models/Supabase/gte-small/onnx/model_quantized.onnx",
    import.meta.url,
  ).href,
};

/**
 * transformers resolves local files as `<localModelPath><model>/<file>`;
 * this prefix is never fetched as such, `env.fetch` maps it to `GTE_FILES`.
 * It must not be an http(s) URL: transformers then skips the local
 * existence check and loads no tokenizer.
 */
const PACKAGE_MODELS = "/__bai-package-models__/";

export interface GteEmbedder {
  embed: EmbedTexts;
  /** Import + model load wall time, ms. */
  loadMs: number;
}

export const GTE_MODEL = "Supabase/gte-small";

/** Everything that decides the vectors besides the input text. */
export const GTE_SPEC = {
  model: GTE_MODEL,
  dtype: "q8",
  pooling: "mean",
  normalize: true,
} as const;

let loading: Promise<GteEmbedder> | null = null;

export function loadGteEmbedder(
  opts: GteEmbedderOptions = {},
): Promise<GteEmbedder> {
  loading ??= (async () => {
    const t0 = performance.now();
    const tf = await import("@huggingface/transformers");
    tf.env.allowLocalModels = true;
    tf.env.allowRemoteModels = false;
    tf.env.useBrowserCache = false;
    tf.env.localModelPath = opts.localModelPath ?? PACKAGE_MODELS;
    if (!opts.localModelPath) {
      const prefix = `${PACKAGE_MODELS}${GTE_MODEL}/`;
      const base = tf.env.fetch;
      tf.env.fetch = (input, init) => {
        const url = typeof input === "string" ? input : input.href;
        const at = url.indexOf(prefix);
        const file = at >= 0 ? GTE_FILES[url.slice(at + prefix.length)] : null;
        if (at >= 0 && !file)
          return Promise.resolve(new Response(null, { status: 404 }));
        return base(file ?? input, init);
      };
    }
    const wasm = tf.env.backends.onnx.wasm;
    if (wasm) {
      // Set after import: transformers assigns jsdelivr paths at init.
      wasm.wasmPaths = opts.wasmPaths ?? ORT_WASM_PATHS;
      // Else transformers may re-wrap the .mjs as a blob: module URL,
      // which `script-src` (no blob:) refuses.
      tf.env.useWasmCache = false;
    }
    const extractor = await tf.pipeline("feature-extraction", GTE_MODEL, {
      dtype: GTE_SPEC.dtype,
      device: "wasm",
    });
    const embed: EmbedTexts = async (texts) => {
      const out = await extractor(texts, {
        pooling: GTE_SPEC.pooling,
        normalize: GTE_SPEC.normalize,
      });
      const [n, d] = out.dims;
      const data = out.data;
      if (!(data instanceof Float32Array))
        throw new Error("gte-small: expected float32 output");
      return Array.from({ length: n }, (_, i) =>
        data.slice(i * d, (i + 1) * d),
      );
    };
    return { embed, loadMs: performance.now() - t0 };
  })().catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}
