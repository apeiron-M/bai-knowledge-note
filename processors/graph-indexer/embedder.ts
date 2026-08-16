import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import type * as TransformersModule from "@huggingface/transformers";

/**
 * Server-side embedding with two loading strategies, tried in order:
 *
 * 1. NATIVE — plain `import("@huggingface/transformers")`. Its exports map
 *    routes Node to `transformers.node.mjs`, which hard-requires the
 *    onnxruntime-node NATIVE binding at module scope (no runtime guard in
 *    v4 — backend choice moved from a process.release check into the
 *    exports map). This works when running from source with a real
 *    node_modules (local `ph vetra`) and is the fastest path.
 *
 * 2. WASM — the same package's `transformers.web.js` build, imported by
 *    file path. Needed everywhere the native binding can't load:
 *    - from a BUNDLED dist: the bundler inlines onnxruntime-node's
 *      binding.js, whose `require('../bin/napi-v6/<platform>/<arch>/
 *      onnxruntime_binding.node')` is relative to the bundle and can never
 *      resolve;
 *    - on deployed Switchboards that stub native modules (the pod threw
 *      exactly that "Cannot find module ... onnxruntime_binding.node").
 *    The web build runs the browser flow end to end on onnxruntime-web
 *    (pure JS + WASM). Making it work under Node needs four tricks,
 *    each empirically required:
 *    - import it with process.release.name spoofed to "browser", so its
 *      env detection buffers model files instead of expecting fs paths;
 *    - a fetch() shim for the file: scheme (Node's fetch refuses it), so
 *      the browser flow can "download" local files;
 *    - localModelPath as a file:// URL, so its URL handling parses;
 *    - ort wasmPaths as a STRING file:// directory with numThreads=1 and
 *      proxy=false. The string form matters: an OBJECT wasmPaths triggers
 *      transformers' blob-URL pre-cache dance and Node cannot import
 *      blob: URLs; left unset, transformers defaults to a jsdelivr https
 *      URL that Node cannot import either.
 */

let extractor: FeatureExtractionPipeline | null = null;
let loading: Promise<FeatureExtractionPipeline> | null = null;

/** Import an ESM specifier with process.release.name spoofed to "browser"
 * for the duration of the import. Both the file-path web build and the
 * CDN-fetched web bundle need this: their env detection runs at module
 * init, and only browser mode buffers fetched files instead of demanding
 * filesystem paths. The value is captured into module closures at init;
 * restoring afterwards leaves the rest of the process untouched. */
async function spoofedImport(
  specifier: string,
): Promise<typeof TransformersModule> {
  const originalRelease = process.release;
  Object.defineProperty(process, "release", {
    value: { ...originalRelease, name: "browser" },
    configurable: true,
    writable: true,
  });
  try {
    // Variable specifier is the point (file URL or data: URL decided at
    // runtime); Vite SSR can't and shouldn't analyze it.
    return (await import(/* @vite-ignore */ specifier)) as typeof TransformersModule;
  } finally {
    Object.defineProperty(process, "release", {
      value: originalRelease,
      configurable: true,
      writable: true,
    });
  }
}

function toJsDataUrl(code: string): string {
  return `data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;
}

/** Pin ort to single-threaded, non-proxied WASM. Threads and the proxy
 * spawn Workers from blob: URLs, which Node's ESM loader refuses — this
 * exact failure cost a debugging session; do not remove. */
function configureOrtWasm(
  transformers: typeof TransformersModule,
  wasmPaths: unknown,
  wasmBinary?: Uint8Array,
): void {
  const onnxWasm = (
    transformers.env.backends as {
      onnx?: {
        wasm?: {
          numThreads?: number;
          proxy?: boolean;
          wasmPaths?: unknown;
          wasmBinary?: Uint8Array;
        };
      };
    }
  ).onnx?.wasm;
  if (!onnxWasm) return;
  onnxWasm.numThreads = 1;
  onnxWasm.proxy = false;
  onnxWasm.wasmPaths = wasmPaths;
  if (wasmBinary) onnxWasm.wasmBinary = wasmBinary;
}

/** Serve file:// URLs from disk through fetch(); pass everything else
 * through. Node's fetch rejects the file: scheme outright, so this is
 * strictly additive. Installed once, only when the WASM strategy runs. */
let fetchShimInstalled = false;
async function installFileFetchShim(): Promise<void> {
  if (fetchShimInstalled) return;
  fetchShimInstalled = true;
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith("file:")) {
      try {
        const data = await readFile(fileURLToPath(url));
        return new Response(new Uint8Array(data), {
          status: 200,
          headers: { "content-length": String(data.byteLength) },
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

/** Walk up from startDir looking for relPath; also try the cwd. */
async function findUp(
  startDir: string,
  relPath: string,
): Promise<string | null> {
  const { existsSync } = await import("node:fs");
  const path = await import("node:path");
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, relPath);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const fromCwd = path.join(process.cwd(), relPath);
  return existsSync(fromCwd) ? fromCwd : null;
}

/** Locate the shipped/committed model directory. */
async function findModelPath(moduleDir: string): Promise<string | null> {
  const { existsSync } = await import("node:fs");
  const path = await import("node:path");
  const probe = "Supabase/gte-small/onnx/model_quantized.onnx";
  const candidates = [
    path.join(moduleDir, "models"), // dist/node/models (published package)
    path.join(moduleDir, "..", "..", "models"), // repo root when running from source
    path.join(moduleDir, "..", "..", "..", "models"),
  ];
  return candidates.find((p) => existsSync(path.join(p, probe))) ?? null;
}

async function loadNative(
  modelPath: string | null,
): Promise<FeatureExtractionPipeline> {
  const transformers = await import("@huggingface/transformers");
  if (modelPath) {
    transformers.env.allowLocalModels = true;
    transformers.env.localModelPath = modelPath;
    transformers.env.allowRemoteModels = false;
  }
  const ext = await transformers.pipeline(
    "feature-extraction",
    "Supabase/gte-small",
    { dtype: "q8" },
  );
  console.log(
    `[Embedder] Model loaded (native onnxruntime): ${modelPath ?? "HF hub"}`,
  );
  return ext;
}

async function loadWasm(
  moduleDir: string,
  modelPath: string | null,
): Promise<FeatureExtractionPipeline> {
  const { pathToFileURL } = await import("node:url");

  const webBuild = await findUp(
    moduleDir,
    "node_modules/@huggingface/transformers/dist/transformers.web.js",
  );
  if (!webBuild) {
    throw new Error(
      "cannot locate @huggingface/transformers/dist/transformers.web.js in any node_modules",
    );
  }
  // ort's helper mjs version must match the ort JS the web build imports,
  // so prefer the installed onnxruntime-web (transformers' own dependency);
  // the wasm/ directory shipped in dist is the same-version fallback copied
  // at build time.
  const ortDist =
    (await findUp(moduleDir, "node_modules/onnxruntime-web/dist")) ??
    (await findUp(
      moduleDir,
      "node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist",
    )) ??
    (await findUp(moduleDir, "wasm"));
  if (!ortDist) {
    throw new Error("cannot locate onnxruntime-web WASM assets");
  }

  await installFileFetchShim();

  const transformers = await spoofedImport(pathToFileURL(webBuild).href);

  if (modelPath) {
    transformers.env.allowLocalModels = true;
    transformers.env.localModelPath = pathToFileURL(modelPath).href;
    // Hard guarantee: with local files present we never touch the network.
    transformers.env.allowRemoteModels = false;
  }
  transformers.env.useBrowserCache = false;
  configureOrtWasm(transformers, `${pathToFileURL(ortDist).href}/`);

  const ext = await transformers.pipeline(
    "feature-extraction",
    "Supabase/gte-small",
    { dtype: "q8" },
  );
  console.log(
    `[Embedder] Model loaded (wasm onnxruntime): ${modelPath ?? "HF hub"}`,
  );
  return ext;
}

/**
 * CDN branch: deployed Switchboards (Vetra Cloud) import package chunks
 * over HTTP(S) from the registry — import.meta.url is not file:// and no
 * node_modules exists to resolve from. The runtime-assets script ships a
 * SELF-CONTAINED transformers web bundle (bare imports inlined) plus the
 * ort helper pair next to the chunks, so everything is fetchable relative
 * to this module's URL:
 *  - the web bundle and ort helper are imported via data: URLs (Node
 *    natively imports data:, avoiding any question of https import
 *    support and any filesystem writes — readOnlyRootFilesystem-safe);
 *  - the ort WASM binary is passed inline via wasmBinary;
 *  - the model weights are fetched by transformers itself from
 *    `<moduleDir>/models/` via remoteHost.
 */
async function loadFromCdn(base: string): Promise<FeatureExtractionPipeline> {
  const fetchText = async (url: string): Promise<string> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    return res.text();
  };
  const fetchBytes = async (url: string): Promise<Uint8Array> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };

  const [webSrc, ortHelper, ortWasm] = await Promise.all([
    fetchText(`${base}transformers.web.bundle.mjs`),
    fetchText(`${base}wasm/ort-wasm-simd-threaded.asyncify.mjs`),
    fetchBytes(`${base}wasm/ort-wasm-simd-threaded.asyncify.wasm`),
  ]);

  const transformers = await spoofedImport(toJsDataUrl(webSrc));

  transformers.env.allowLocalModels = false;
  transformers.env.allowRemoteModels = true;
  transformers.env.remoteHost = `${base}models/`;
  transformers.env.remotePathTemplate = "{model}/";
  transformers.env.useBrowserCache = false;
  // Must stay false: true triggers transformers' blob-URL pre-cache of the
  // ort helper, and Node cannot import blob: URLs.
  transformers.env.useWasmCache = false;

  configureOrtWasm(
    transformers,
    {
      // The helper module checks for Node to pick an incompatible branch —
      // patch the check off, exactly as transformers' own loadWasmFactory
      // does for browsers.
      mjs: toJsDataUrl(
        ortHelper.replaceAll("globalThis.process?.versions?.node", "false"),
      ),
      // Kept for completeness; ort uses wasmBinary when present.
      wasm: `${base}wasm/ort-wasm-simd-threaded.asyncify.wasm`,
    },
    ortWasm,
  );

  const ext = await transformers.pipeline(
    "feature-extraction",
    "Supabase/gte-small",
    { dtype: "q8" },
  );
  console.log(`[Embedder] Model loaded (wasm onnxruntime, CDN): ${base}`);
  return ext;
}

export async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;

  // Prevent concurrent loads — share the same promise
  if (!loading) {
    loading = (async () => {
      const moduleUrl = import.meta.url;
      // Test override: point the CDN branch at any static server
      // (EMBEDDER_CDN_BASE=http://localhost:8000/dist/node/) to exercise
      // the deployed-Switchboard path without a deployment.
      const cdnBase =
        process.env.EMBEDDER_CDN_BASE ??
        (moduleUrl.startsWith("http")
          ? moduleUrl.slice(0, moduleUrl.lastIndexOf("/") + 1)
          : null);
      if (cdnBase) {
        extractor = await loadFromCdn(cdnBase);
        loading = null;
        return extractor;
      }
      if (!moduleUrl.startsWith("file:")) {
        throw new Error(
          `[Embedder] unsupported module URL scheme: ${moduleUrl.slice(0, 120)}`,
        );
      }
      const { fileURLToPath } = await import("node:url");
      const path = await import("node:path");
      const moduleDir = path.dirname(fileURLToPath(moduleUrl));
      const modelPath = await findModelPath(moduleDir);

      try {
        extractor = await loadNative(modelPath);
      } catch (nativeErr) {
        console.log(
          `[Embedder] native onnxruntime unavailable (${
            nativeErr instanceof Error ? nativeErr.message : String(nativeErr)
          }), falling back to wasm`,
        );
        extractor = await loadWasm(moduleDir, modelPath);
      }
      loading = null;
      return extractor;
    })();
    // A failed load must not poison every future call with the same
    // rejected promise-chain: allow the next caller to retry.
    loading.catch(() => {
      loading = null;
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
