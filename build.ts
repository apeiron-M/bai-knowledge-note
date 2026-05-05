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
 * Entry points are explicitly declared below so it's obvious what gets built:
 * the package root, document models, all 11 editors, the drive-app, the
 * graph-indexer processor, and the knowledge-graph subgraph.
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

/**
 * Ensure the embedding model files are present. They're shipped in dist/
 * so the deployed switchboard never has to reach huggingface.co at runtime
 * — the container only needs to reach the same CDN that serves our JS.
 * Idempotent: the script skips files already on disk.
 */
const modelMarkerPath = resolve(
  "models/Supabase/gte-small/onnx/model_quantized.onnx",
);
if (!existsSync(modelMarkerPath)) {
  execSync("node scripts/fetch-model.mjs", { stdio: "inherit" });
}

/**
 * Force `@huggingface/transformers` to resolve to its WASM (web) entry
 * instead of the default Node entry. The Node entry pulls in
 * `onnxruntime-node` whose native `.node` binary isn't shipped on the
 * deployed vetra switchboard image — runtime resolution fails with
 * `Cannot find module '../bin/napi-v6/linux/x64/onnxruntime_binding.node'`.
 * The web entry uses `onnxruntime-web` (WASM, no native deps) and runs in
 * any JS environment, including Node.
 */
const transformersWebEntry = resolve(
  dirname(require.resolve("@huggingface/transformers/package.json")),
  "dist/transformers.web.js",
);

const transformersAlias = {
  "@huggingface/transformers": transformersWebEntry,
};

const REACT_EXTERNALS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react-dom/client",
];

// Explicit entry list — covers every public surface of this package.
// Editors use `module.ts` (lazy-loaded `editor.tsx` via React.lazy).
// Globs are kept as a safety net in case new modules are added without
// updating this file.
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

// tsdown exports `browserBuildConfig`/`nodeBuildConfig` as `ResolvedConfig`,
// but `build()` accepts `InlineConfig`. The shapes overlap at runtime — the
// cast tells TS "trust me" for the few non-overlapping fields (like `copy`).
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

// tsdown's `copy` option targets single files; for the model directory we
// copy recursively after the bundles land. The embedder resolves
// `${moduleDir}models/` at runtime, so the trees need to sit alongside the
// emitted JS chunks in both dist/browser/ and dist/node/. Wipe any stale
// copy first so re-runs don't accumulate nested `models/models/` paths.
execSync("rm -rf dist/browser/models dist/node/models", { stdio: "inherit" });
execSync("cp -r models dist/browser/", { stdio: "inherit" });
execSync("cp -r models dist/node/", { stdio: "inherit" });

// Tailwind step — mirrors what ph-cli's build does after the bundle phase.
execSync("bun x @tailwindcss/cli -i ./style.css -o ./dist/style.css", {
  stdio: "inherit",
});
