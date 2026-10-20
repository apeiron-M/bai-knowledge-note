/**
 * Lazy browser loader for the committed `models/Supabase/gte-small` q8
 * embedder (the graph indexer's model), on the wasm backend so it does not
 * compete with wllama for the GPU. Nothing is imported until the first call,
 * so the Chat tab pays for it only when a request is unscoped.
 * Known gap: without `wasmPaths`, onnxruntime-web fetches its wasm from
 * jsdelivr, which Connect's CSP blocks.
 */
import type { EmbedTexts } from "./op-embeddings.js";

export interface GteEmbedderOptions {
  /** URL prefix under which `Supabase/gte-small/` is served. */
  localModelPath: string;
  /** onnxruntime-web wasm directory URL (default: transformers' CDN). */
  wasmPaths?: string;
}

export interface GteEmbedder {
  embed: EmbedTexts;
  /** Import + model load wall time, ms. */
  loadMs: number;
}

export const GTE_MODEL = "Supabase/gte-small";

let loading: Promise<GteEmbedder> | null = null;

export function loadGteEmbedder(
  opts: GteEmbedderOptions,
): Promise<GteEmbedder> {
  loading ??= (async () => {
    const t0 = performance.now();
    const tf = await import("@huggingface/transformers");
    tf.env.allowLocalModels = true;
    tf.env.localModelPath = opts.localModelPath;
    tf.env.allowRemoteModels = false;
    tf.env.useBrowserCache = false;
    const wasm = tf.env.backends.onnx.wasm;
    if (opts.wasmPaths && wasm) wasm.wasmPaths = opts.wasmPaths;
    const extractor = await tf.pipeline("feature-extraction", GTE_MODEL, {
      dtype: "q8",
      device: "wasm",
    });
    const embed: EmbedTexts = async (texts) => {
      const out = await extractor(texts, { pooling: "mean", normalize: true });
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
