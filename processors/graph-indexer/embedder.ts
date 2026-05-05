import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

let extractor: FeatureExtractionPipeline | null = null;
let loading: Promise<FeatureExtractionPipeline> | null = null;
let cachedWasmFileUrls: { mjs: string; wasm: string } | null = null;

/**
 * Pre-fetch the onnxruntime-web helper module and its WASM binary from
 * our package CDN, write them to a tmp dir, and return file:// URLs.
 * Required because ort-web tries to load these via Node fs APIs that
 * only accept file URLs / absolute paths — passing the original HTTPS
 * URL throws ERR_INVALID_ARG_VALUE.
 *
 * The helper module checks `globalThis.process?.versions?.node` at
 * runtime to pick a Node-specific code path (which then uses fs in
 * ways our deployment can't satisfy). We patch that check to `false`
 * before writing — same workaround transformers' own loadWasmFactory
 * does for browsers, but applied at the file level so Node can load
 * the helper directly via file URL.
 */
async function materializeWasmFiles(
  wasmHost: string,
): Promise<{ mjs: string; wasm: string }> {
  if (cachedWasmFileUrls) return cachedWasmFileUrls;
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "knowledge-note-ort-"),
  );
  const [mjsRes, wasmRes] = await Promise.all([
    fetch(`${wasmHost}ort-wasm-simd-threaded.asyncify.mjs`),
    fetch(`${wasmHost}ort-wasm-simd-threaded.asyncify.wasm`),
  ]);
  if (!mjsRes.ok) {
    throw new Error(
      `Failed to fetch ort helper mjs: ${mjsRes.status} ${mjsRes.statusText}`,
    );
  }
  if (!wasmRes.ok) {
    throw new Error(
      `Failed to fetch ort wasm binary: ${wasmRes.status} ${wasmRes.statusText}`,
    );
  }
  let helper = await mjsRes.text();
  helper = helper.replaceAll("globalThis.process?.versions?.node", "false");
  const wasmBytes = Buffer.from(await wasmRes.arrayBuffer());
  const mjsPath = path.join(tmpDir, "ort-wasm-simd-threaded.asyncify.mjs");
  const wasmPath = path.join(tmpDir, "ort-wasm-simd-threaded.asyncify.wasm");
  await Promise.all([
    fs.writeFile(mjsPath, helper, "utf8"),
    fs.writeFile(wasmPath, wasmBytes),
  ]);
  cachedWasmFileUrls = {
    mjs: pathToFileURL(mjsPath).href,
    wasm: pathToFileURL(wasmPath).href,
  };
  return cachedWasmFileUrls;
}

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
      // cdn.jsdelivr.net). build.ts ships the helper files at
      // dist/<platform>/wasm/, but ort-web tries to read them via
      // Node fs APIs that reject HTTPS URLs — so we materialize them
      // in a tmp directory first and pass file:// URLs.
      const wasmFileUrls = await materializeWasmFiles(wasmHost);
      const onnx = (
        transformers.env.backends as { onnx?: { wasm?: Record<string, unknown> } }
      ).onnx;
      if (onnx?.wasm) {
        onnx.wasm.wasmPaths = wasmFileUrls;
      }
      // Skip transformers' own pre-fetch+blob-URL dance over our
      // wasmPaths — we already have them as file URLs.
      transformers.env.useWasmCache = false;

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
