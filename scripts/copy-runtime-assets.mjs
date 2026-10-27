// Ship the runtime files `ph build` doesn't know about, and keep the embedder's
// out of the tarball.
//
// The embedder's runtime (model, ONNX runtime wasm, transformers web bundle) is
// its own package, @powerhousedao/knowledge-vault-assets (packages/
// knowledge-vault-assets), loaded from disk where it is installed and from the
// registry CDN everywhere else (processors/graph-indexer/embedder.ts). Copying
// it into dist/ made every vault publish 30 MB heavier for files that never
// change, and the copy was never found by a Switchboard running the package
// from its registry cache anyway.
//
// It runs from two hooks, and both matter:
//  - `build`: so a manual build leaves a complete dist.
//  - `prepack`: so the tarball is complete no matter what rebuilt dist last
//    (`ph vetra --watch` re-runs a bare `ph-cli build` on any file change).
import {
  copyFileSync,
  existsSync,
  globSync,
  mkdirSync,
  rmSync,
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

// 1. Strip the browser build's ort WASM asset (~22.8MB). The browser bundle
//    still carries the embedder chunk because the processor barrel imports
//    it dynamically, but every call site is behind the server-only
//    EMBEDDING_ENABLED gate, so the chunk — and therefore this asset — can
//    never load in a browser. Pure tarball/CDN dead weight.
for (const deadWasm of globSync(
  join(distRoot, "browser", "assets", "ort-wasm-*"),
)) {
  rmSync(deadWasm);
  console.log(`[runtime-assets] removed dead browser asset ${deadWasm}`);
}

// 2. Pipeline template → dist/node/pieces/knowledge-vault/templates/ (spec §7.5
//    of the desktop app: the template ships with the piece it belongs to and is
//    imported as @powerhousedao/knowledge-note/pieces/knowledge-vault/templates/pipeline.json).
const templatesSrc = join("pieces", "knowledge-vault", "templates");
const templatesProbe = join(templatesSrc, "pipeline.json");
if (!existsSync(templatesProbe)) fail(`missing ${templatesProbe} — run scripts/export-workflow-template.mjs`);
const templatesDest = join(distRoot, "node", "pieces", "knowledge-vault", "templates");
rmSync(templatesDest, { recursive: true, force: true });
mkdirSync(templatesDest, { recursive: true });
for (const f of globSync(join(templatesSrc, "*.json"))) copyFileSync(f, join(templatesDest, f.split("/").pop()));
console.log(`[runtime-assets] pipeline template → ${templatesDest}`);

// 3. The embedder's runtime belongs to the assets package. Whatever left a copy
//    in dist/node (an older build in the same folder), it never reaches the tarball.
for (const stale of [
  join(distRoot, "node", "models"),
  join(distRoot, "node", "wasm"),
  join(distRoot, "node", "transformers.web.bundle.mjs"),
]) {
  if (!existsSync(stale)) continue;
  rmSync(stale, { recursive: true, force: true });
  console.log(`[runtime-assets] removed ${stale}: it ships in @powerhousedao/knowledge-vault-assets`);
}

console.log("[runtime-assets] ok");
