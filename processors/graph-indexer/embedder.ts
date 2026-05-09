import type { FeatureExtractionPipeline } from "@huggingface/transformers";

let extractor: FeatureExtractionPipeline | null = null;
let loading: Promise<FeatureExtractionPipeline> | null = null;
let cachedOrtAssets: { mjsDataUrl: string; wasmBinary: Uint8Array } | null =
  null;

/**
 * Pre-fetch onnxruntime-web's WASM helper module and binary from our package
 * CDN, returning forms that don't require any filesystem access:
 *
 *  - Helper `.mjs` → `data:` URL. Node natively supports
 *    `import("data:text/javascript;base64,...")`, so ort can dynamically
 *    import the helper without writing to disk or reaching jsdelivr.
 *  - WASM binary → `Uint8Array`, set as `env.backends.onnx.wasm.wasmBinary`
 *    on the ort runtime. ort skips the file load entirely when given an
 *    inline binary.
 *
 * The helper module checks `globalThis.process?.versions?.node` to pick a
 * Node-only branch that's incompatible with our deployment. We patch that
 * check to `false` before encoding the data URL — the same workaround
 * transformers' loadWasmFactory normally does for browsers, applied at
 * the source level so Node can `import()` the patched module.
 *
 * Avoiding the filesystem matters in container deployments: many k8s
 * security profiles enable `readOnlyRootFilesystem` without a writable
 * `/tmp` mount.
 */
async function loadOrtAssets(
  wasmHost: string,
): Promise<{ mjsDataUrl: string; wasmBinary: Uint8Array }> {
  if (cachedOrtAssets) return cachedOrtAssets;
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
  const helperBase64 = Buffer.from(helper, "utf8").toString("base64");
  const mjsDataUrl = `data:text/javascript;base64,${helperBase64}`;
  const wasmBinary = new Uint8Array(await wasmRes.arrayBuffer());
  cachedOrtAssets = { mjsDataUrl, wasmBinary };
  return cachedOrtAssets;
}

export async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;

  // Prevent concurrent loads — share the same promise
  if (!loading) {
    loading = (async () => {
      // Spoof process.release.name to "browser" while transformers'
      // module init runs. Otherwise its IS_NODE_ENV check
      // (`process?.release?.name === "node"`) flips on, and the ONNX
      // model loader requests a local file path that can't resolve
      // against a remote URL. The IS_NODE_ENV value is captured into
      // module closures at init time, so restoring process.release
      // after the import keeps the rest of the Node runtime unaffected.
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

      // URLs computed via string ops so rolldown's resolveNewUrlToAsset
      // doesn't try to inline `models/`/`wasm/` as build-time assets.
      // build.ts ships both directories alongside the JS chunks, so
      // these resolve to the package CDN root + relative path.
      const moduleUrl = import.meta.url;
      const moduleDir = moduleUrl.slice(0, moduleUrl.lastIndexOf("/") + 1);
      const modelHost = `${moduleDir}models/`;
      const wasmHost = `${moduleDir}wasm/`;

      // Model files: served from our CDN, fetched on demand.
      transformers.env.allowLocalModels = false;
      transformers.env.allowRemoteModels = true;
      transformers.env.remoteHost = modelHost;
      transformers.env.remotePathTemplate = "{model}/";
      transformers.env.useBrowserCache = false;
      // Skip transformers' own pre-fetch+blob-URL dance; we install our
      // own data URL + wasmBinary below.
      transformers.env.useWasmCache = false;

      // Pre-fetch ort helper + binary, install on ort env.
      const { mjsDataUrl, wasmBinary } = await loadOrtAssets(wasmHost);
      const onnx = (
        transformers.env.backends as {
          onnx?: {
            wasm?: {
              wasmPaths?: { mjs?: string; wasm?: string };
              wasmBinary?: Uint8Array;
            };
          };
        }
      ).onnx;
      if (onnx?.wasm) {
        onnx.wasm.wasmBinary = wasmBinary;
        onnx.wasm.wasmPaths = {
          mjs: mjsDataUrl,
          // Kept for completeness; ort uses wasmBinary when present.
          wasm: `${wasmHost}ort-wasm-simd-threaded.asyncify.wasm`,
        };
      }

      const ext = await transformers.pipeline(
        "feature-extraction",
        "Supabase/gte-small",
        { dtype: "q8" },
      );
      extractor = ext;
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
