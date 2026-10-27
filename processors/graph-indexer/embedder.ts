import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import type * as TransformersModule from "@huggingface/transformers";
import {
  ASSETS_PACKAGE,
  LOCAL_MODEL_DIRS,
  LOCAL_ORT_DIR,
  MODEL_PROBE,
  assetsCdnBase,
  registryCandidates,
} from "./assets.js";

/**
 * Server-side embedding. The model and the runtime come from the assets
 * package (see ./assets.ts), tried in this order:
 *
 *  1. EMBEDDER_CDN_BASE, when set: that folder, over HTTP. For tests and
 *     emergencies.
 *  2. A copy of the model on disk — the installed assets package (desktop,
 *     `ph install`) or this repository's packages/knowledge-vault-assets
 *     (`ph vetra`, tests) — loaded NATIVE, then WASM (below).
 *  3. The assets package on the registry CDN. This is the deployed
 *     Switchboard: it runs this module from its registry cache (file://) or
 *     over HTTP, with neither the model nor node_modules beside it.
 *
 * Hugging Face is never contacted at run time.
 *
 * The two on-disk strategies:
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

/** Locate a copy of the model on disk: the installed assets package, or this repository's. */
async function findModelPath(moduleDir: string): Promise<string | null> {
  const { existsSync } = await import("node:fs");
  const path = await import("node:path");
  for (const dir of LOCAL_MODEL_DIRS) {
    const found = await findUp(moduleDir, dir);
    if (found && existsSync(path.join(found, MODEL_PROBE))) return found;
  }
  return null;
}

/** The Switchboard's configured registry (powerhouse.config.json in its working directory), if any. */
async function configuredRegistry(): Promise<string | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const config = JSON.parse(await readFile(path.join(process.cwd(), "powerhouse.config.json"), "utf8")) as {
      packageRegistryUrl?: unknown;
    };
    return typeof config.packageRegistryUrl === "string" ? config.packageRegistryUrl : null;
  } catch {
    return null;
  }
}

/** The native-backed transformers package, loaded by name at run time (see loadNative). */
const TRANSFORMERS_PACKAGE = "@huggingface/transformers";

async function loadNative(
  modelPath: string,
): Promise<FeatureExtractionPipeline> {
  // A variable specifier on purpose. Built with ph-cli >= 6.2.3-dev.51, a literal import of this
  // native-backed package is listed in the manifest's externalDependencies, and a Switchboard >= dev.51
  // that loads the package from a registry (no node_modules) then refuses every subgraph and processor
  // when it cannot resolve it. Native onnxruntime is optional here (loadWasm takes over when this
  // throws), so it must not become a hard dependency; at run time it resolves like any import.
  const specifier = TRANSFORMERS_PACKAGE;
  const transformers = (await import(/* @vite-ignore */ specifier)) as typeof TransformersModule;
  transformers.env.allowLocalModels = true;
  transformers.env.localModelPath = modelPath;
  transformers.env.allowRemoteModels = false;
  const ext = await transformers.pipeline(
    "feature-extraction",
    "Supabase/gte-small",
    { dtype: "q8" },
  );
  console.log(
    `[Embedder] Model loaded (native onnxruntime): ${modelPath}`,
  );
  return ext;
}

async function loadWasm(
  moduleDir: string,
  modelPath: string,
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
    (await findUp(moduleDir, LOCAL_ORT_DIR));
  if (!ortDist) {
    throw new Error("cannot locate onnxruntime-web WASM assets");
  }

  await installFileFetchShim();

  const transformers = await spoofedImport(pathToFileURL(webBuild).href);

  transformers.env.allowLocalModels = true;
  transformers.env.localModelPath = pathToFileURL(modelPath).href;
  // Hard guarantee: with local files present we never touch the network.
  transformers.env.allowRemoteModels = false;
  transformers.env.useBrowserCache = false;
  configureOrtWasm(transformers, `${pathToFileURL(ortDist).href}/`);

  const ext = await transformers.pipeline(
    "feature-extraction",
    "Supabase/gte-small",
    { dtype: "q8" },
  );
  console.log(
    `[Embedder] Model loaded (wasm onnxruntime): ${modelPath}`,
  );
  return ext;
}

/**
 * CDN branch: deployed Switchboards (Vetra Cloud) run this package from
 * their registry cache, with no node_modules and no model beside it. The
 * assets package ships a SELF-CONTAINED transformers web bundle (bare
 * imports inlined), the ort helper pair and the model, all fetchable from
 * its CDN folder `base`:
 *  - the web bundle and ort helper are imported via data: URLs (Node
 *    natively imports data:, avoiding any question of https import
 *    support and any filesystem writes — readOnlyRootFilesystem-safe);
 *  - the ort WASM binary is passed inline via wasmBinary;
 *  - the model weights are fetched by transformers itself from
 *    `<base>models/` via remoteHost.
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
      const override = process.env.EMBEDDER_CDN_BASE;
      if (override) return loadFromCdn(override);

      const moduleUrl = import.meta.url;
      const failed: string[] = [];
      const reason = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

      if (moduleUrl.startsWith("file:")) {
        const { fileURLToPath } = await import("node:url");
        const path = await import("node:path");
        const moduleDir = path.dirname(fileURLToPath(moduleUrl));
        const modelPath = await findModelPath(moduleDir);
        if (modelPath) {
          try {
            return await loadNative(modelPath);
          } catch (e) {
            console.log(`[Embedder] native onnxruntime unavailable (${reason(e)}), falling back to wasm`);
          }
          try {
            return await loadWasm(moduleDir, modelPath);
          } catch (e) {
            failed.push(`wasm: ${reason(e)}`);
          }
        } else {
          failed.push(`no ${ASSETS_PACKAGE} on disk`);
        }
      }

      const registries = registryCandidates({
        moduleUrl,
        env: process.env.PH_REGISTRY_URL,
        configured: await configuredRegistry(),
      });
      for (const registry of registries) {
        const base = assetsCdnBase(registry);
        try {
          return await loadFromCdn(base);
        } catch (e) {
          failed.push(`${base}: ${reason(e)}`);
        }
      }
      throw new Error(`[Embedder] no embedding runtime could load: ${failed.join("; ")}`);
    })().then((ext) => {
      extractor = ext;
      loading = null;
      return ext;
    });
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
