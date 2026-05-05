/**
 * Custom build driver that fixes the "two React instances" problem when the
 * package is loaded by a deployed Connect.
 *
 * The default `ph-cli build` (via `@powerhousedao/shared/clis`) uses
 * `deps.alwaysBundle: ["**"]` and filters React out of `browserNeverBundle`,
 * which ends up emitting a chunk (e.g. `react-*.js`) that contains the full
 * React source. When Connect imports the editor module from the CDN it pulls
 * that chunk in alongside its own React, producing two React instances and
 * breaking hooks with:
 *   `TypeError: Cannot read properties of null (reading 'useState')`
 *
 * This script reuses the shared Powerhouse build configs but forces React,
 * react-dom, and their sub-paths into `deps.neverBundle`, which tsdown passes
 * to rolldown as a hard `external`. Emitted chunks then contain bare
 * `import … from "react"` / `"react-dom"` statements, which Connect resolves
 * against its own React at runtime — so there's only ever one React.
 *
 * Embedder runtime support (for vetra HTTP-CDN deployments):
 * - Aliases `@huggingface/transformers` → its `dist/transformers.web.js`
 *   (WASM via onnxruntime-web; no native onnxruntime-node binary needed).
 * - After bundling, copies the embedding model + onnxruntime-web's WASM
 *   helper module + binary into `dist/{browser,node}/{models,wasm}/`. The
 *   embedder fetches them at first use from the same CDN that delivered
 *   the JS chunks, then loads ort via data:URL + inline wasmBinary so no
 *   filesystem write is required (k8s readOnlyRootFilesystem-friendly).
 *
 * Entry points are explicitly declared below so it's obvious what gets built.
 */

import {
  browserBuildConfig,
  nodeBuildConfig,
} from "@powerhousedao/shared/clis";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { build, type InlineConfig } from "tsdown";

const require = createRequire(import.meta.url);

const REACT_EXTERNALS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react-dom/client",
];

// Force `@huggingface/transformers` to its WASM (web) entry. The default
// node entry pulls in onnxruntime-node (native .node binary) which can't
// be loaded by the deployed switchboard's HTTP CDN module loader.
const transformersWebEntry = resolve(
  dirname(require.resolve("@huggingface/transformers/package.json")),
  "dist/transformers.web.js",
);
const transformersAlias = {
  "@huggingface/transformers": transformersWebEntry,
};

// Ensure HF model files are present locally before bundling. Idempotent.
if (
  !existsSync(resolve("models/Supabase/gte-small/onnx/model_quantized.onnx"))
) {
  execSync("node scripts/fetch-model.mjs", { stdio: "inherit" });
}

const entry = [
  // Package root
  "index.ts",

  // Document models (11)
  "document-models/index.ts",
  "document-models/*/index.ts",
  "document-models/*/module.ts",

  // Editors — 10 document editors + 1 drive-app
  "editors/index.ts",
  "editors/editors.ts",
  "editors/*/module.ts",
  "editors/health-report-editor/module.ts",
  "editors/knowledge-graph-editor/module.ts",
  "editors/knowledge-note-editor/module.ts",
  "editors/knowledge-vault/module.ts",
  "editors/moc-editor/module.ts",
  "editors/observation-editor/module.ts",
  "editors/pipeline-queue-editor/module.ts",
  "editors/research-claim-editor/module.ts",
  "editors/source-editor/module.ts",
  "editors/tension-editor/module.ts",
  "editors/vault-config-editor/module.ts",

  // Subgraphs
  "subgraphs/index.ts",
  "subgraphs/*/index.ts",

  // Processors (graph-indexer + future)
  "processors/index.ts",
  "processors/connect.ts",
  "processors/switchboard.ts",
  "processors/factory.ts",
  "processors/*/index.ts",
];

const outDir = "dist";

const existingBrowserNeverBundle = Array.isArray(
  browserBuildConfig.deps?.neverBundle,
)
  ? (browserBuildConfig.deps?.neverBundle as string[])
  : [];

const browserNeverBundle = Array.from(
  new Set([...existingBrowserNeverBundle, ...REACT_EXTERNALS]),
);

const existingNodeNeverBundle = Array.isArray(
  nodeBuildConfig.deps?.neverBundle,
)
  ? (nodeBuildConfig.deps?.neverBundle as string[])
  : [];

const nodeNeverBundle = Array.from(
  new Set([...existingNodeNeverBundle, ...REACT_EXTERNALS]),
);

await build({
  ...(browserBuildConfig as InlineConfig),
  entry,
  outDir: join(outDir, "browser"),
  deps: {
    ...browserBuildConfig.deps,
    neverBundle: browserNeverBundle,
  },
  alias: { ...transformersAlias },
});

await build({
  ...(nodeBuildConfig as InlineConfig),
  entry,
  outDir: join(outDir, "node"),
  deps: {
    ...nodeBuildConfig.deps,
    neverBundle: nodeNeverBundle,
  },
  alias: { ...transformersAlias },
});

// Asset copy: model files + onnxruntime-web wasm helpers. Wipe stale copies
// first so re-runs don't accumulate nested paths.
execSync(
  "rm -rf dist/browser/models dist/node/models dist/browser/wasm dist/node/wasm",
  { stdio: "inherit" },
);
execSync("cp -r models dist/browser/", { stdio: "inherit" });
execSync("cp -r models dist/node/", { stdio: "inherit" });

const ortDist = join(
  dirname(require.resolve("onnxruntime-web/package.json")),
  "dist",
);
const ortFiles = [
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
];
execSync("mkdir -p dist/browser/wasm dist/node/wasm", { stdio: "inherit" });
for (const f of ortFiles) {
  execSync(`cp ${ortDist}/${f} dist/browser/wasm/${f}`, { stdio: "inherit" });
  execSync(`cp ${ortDist}/${f} dist/node/wasm/${f}`, { stdio: "inherit" });
}

// PGlite's vector extension loader does
//   new URL("../vector.tar.gz", import.meta.url)
// from its bundled chunk at dist/node/vector-*.mjs, which resolves to
// dist/vector.tar.gz (the package root on the CDN). Copy the tarball
// from pglite's distribution there so the extension can load.
const pgliteDist = join(
  dirname(require.resolve("@electric-sql/pglite/package.json")),
  "dist",
);
execSync(`cp ${pgliteDist}/vector.tar.gz dist/vector.tar.gz`, {
  stdio: "inherit",
});

// Tailwind step — mirrors what ph-cli's build does after the bundle phase.
execSync("bun x @tailwindcss/cli -i ./style.css -o ./dist/style.css", {
  stdio: "inherit",
});
