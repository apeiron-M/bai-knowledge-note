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
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

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
//    chunks resolve `<moduleDir>/models/`). The browser build deliberately
//    gets NO model: the browser is model-free by design — embedding happens
//    only in the server-side processor and subgraph.
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

console.log("[runtime-assets] ok");
