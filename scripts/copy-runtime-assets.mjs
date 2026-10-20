// Ship the runtime assets `ph build` doesn't know about.
//
// The graph-indexer embeds notes server-side. Its embedder loads the ONNX
// model from `models/` next to the JS chunks (local file:// deployments) or
// from the package CDN (`<chunk-url>/models/`, remote deployments), and the
// onnxruntime WASM helpers from `wasm/` the same way. The old project-level
// build.ts copied all of these into dist; when the project moved to plain
// `ph-cli build` (commit d721d87) the copies silently stopped — which is the
// moment server-side embedding broke and the system fell back to computing
// embeddings in the browser.
//
// This script restores those copies after every build. It fails loudly when
// a source is missing, so a package that would break only once deployed
// never gets published.
//
// It runs from two hooks, and both matter:
//  - `build`: so a manual build leaves a complete dist.
//  - `prepack`: so the tarball is complete no matter what rebuilt dist last.
//    `ph vetra --watch` re-runs a bare `ph-cli build` on any file change,
//    silently wiping these assets from dist — packing right after would ship
//    a package whose remote embedder 404s and semantic search degrades to
//    keyword. prepack runs immediately before the tarball is created (for
//    both `npm pack` and publish), closing that race.
import {
  copyFileSync,
  cpSync,
  existsSync,
  globSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, join } from "node:path";

const distRoot = "dist";

if (!existsSync(distRoot)) {
  console.error("[runtime-assets] no dist/ — run the build first");
  process.exit(1);
}

function fail(msg) {
  console.error(`[runtime-assets] ${msg}`);
  process.exit(1);
}

// 1. Embedding model → dist/node/models/ (node runtime + CDN-served node
//    chunks resolve `<moduleDir>/models/`). This copy is for the server-side
//    processor and subgraph only. The browser build gets its own copies from
//    the bundler: the knowledge-vault Chat tab's query embedder references
//    each gte-small file with `new URL(..., import.meta.url)`
//    (chat/core/gte-embedder.ts), so they land in dist/browser/assets/.
const modelSrc = "models";
const modelProbe = join(
  modelSrc,
  "Supabase/gte-small/onnx/model_quantized.onnx",
);
if (!existsSync(modelProbe)) {
  fail(
    `missing ${modelProbe} — the committed model files are required for ` +
      `server-side embedding. Restore the repo's models/ directory.`,
  );
}
const modelDest = join(distRoot, "node", "models");
rmSync(modelDest, { recursive: true, force: true });
cpSync(modelSrc, modelDest, { recursive: true });
console.log(
  `[runtime-assets] models/ → ${modelDest} (${(statSync(modelProbe).size / 1048576).toFixed(1)}MB onnx)`,
);

// 2. onnxruntime WASM helpers → dist/node/wasm/ (the embedder's CDN branch
//    fetches these; the local branch doesn't need them but shipping them
//    keeps one layout for both).
// Both onnxruntime-web and @huggingface/transformers restrict their exports
// maps, so require.resolve on their package.json throws
// ERR_PACKAGE_PATH_NOT_EXPORTED. Locate by plain path: hoisted first, then
// nested under transformers.
const ortCandidates = [
  join("node_modules", "onnxruntime-web", "dist"),
  join(
    "node_modules",
    "@huggingface",
    "transformers",
    "node_modules",
    "onnxruntime-web",
    "dist",
  ),
];
const ortDist = ortCandidates.find((p) => existsSync(p));
if (!ortDist) {
  fail(
    "cannot locate onnxruntime-web/dist — it ships as a dependency of " +
      "@huggingface/transformers; check the install.",
  );
}
const ortFiles = [
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
];
const wasmDest = join(distRoot, "node", "wasm");
mkdirSync(wasmDest, { recursive: true });
for (const f of ortFiles) {
  const from = join(ortDist, f);
  if (!existsSync(from)) fail(`missing ort helper: ${from}`);
  copyFileSync(from, join(wasmDest, f));
}
console.log(`[runtime-assets] ort wasm helpers → ${wasmDest}`);

// 3. Strip unreferenced ort WASM assets from the browser build. The chat
//    embedder (chat/core/gte-embedder.ts) runs onnxruntime-web in the
//    browser from the vendored `ort-wasm-simd-threaded.asyncify.{mjs,wasm}`
//    (vendor/onnxruntime-web/), which the bundler emits as
//    `assets/ort-wasm-*`, so those must ship. It is byte-identical to the
//    wasm onnxruntime-web's own bundle references, so both resolve to one
//    hashed file. Only an `ort-wasm-*` asset that no browser chunk names is
//    dead weight; the server path (step 2) is unaffected.
const browserJs = globSync(join(distRoot, "browser", "**", "*.js")).map((f) =>
  readFileSync(f, "utf8"),
);
for (const asset of globSync(
  join(distRoot, "browser", "assets", "ort-wasm-*"),
)) {
  const name = basename(asset);
  if (browserJs.some((src) => src.includes(name))) {
    console.log(`[runtime-assets] kept chat browser asset ${asset}`);
    continue;
  }
  rmSync(asset);
  console.log(`[runtime-assets] removed unreferenced browser asset ${asset}`);
}

// 4. Self-contained transformers WEB build → dist/node/transformers.web.bundle.mjs
//    Deployed Switchboards (Vetra Cloud) import package chunks over HTTPS
//    from the registry — there is no node_modules to resolve from and the
//    dist-bundled transformers node build hard-requires a native binding
//    that can never load there. The embedder's CDN branch instead fetches
//    this bundle and imports it via a data: URL, which only works if the
//    file has zero bare imports — so inline its onnxruntime dependencies
//    here with rolldown.
const webBuildSrc = join(
  "node_modules",
  "@huggingface",
  "transformers",
  "dist",
  "transformers.web.js",
);
if (!existsSync(webBuildSrc)) {
  fail(`missing ${webBuildSrc} — check the @huggingface/transformers install`);
}
const { rolldown } = await import("rolldown");
const webBundleDest = join(distRoot, "node", "transformers.web.bundle.mjs");
const bundle = await rolldown({
  input: webBuildSrc,
  platform: "browser",
  logLevel: "silent",
});
await bundle.write({
  file: webBundleDest,
  format: "esm",
  inlineDynamicImports: true,
  sourcemap: false,
});
await bundle.close();
const bundled = statSync(webBundleDest).size;
if (bundled < 1_000_000) {
  fail(`transformers.web.bundle.mjs suspiciously small (${bundled} bytes)`);
}
console.log(
  `[runtime-assets] transformers web bundle → ${webBundleDest} (${(bundled / 1048576).toFixed(1)}MB)`,
);

console.log("[runtime-assets] ok");
