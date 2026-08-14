// Ship the pgvector extension bundle with the node build.
//
// The graph-indexer's embedding store loads pgvector at runtime:
//
//   const { vector } = await import("@electric-sql/pglite/vector");
//
// and pglite's own shim resolves the extension bundle relative to itself:
//
//   bundlePath: new URL("../vector.tar.gz", import.meta.url)
//
// `ph build` inlines pglite into dist/node/, so that URL resolves to
// `dist/vector.tar.gz`. Only `browserBuildConfig` sets
// `inputOptions.experimental.resolveNewUrlToAsset`, so only the browser build
// emits the tarball (dist/browser/assets/vector.tar-*.gz); the node build emits
// the shim pointing at a file that was never copied.
//
// The failure is invisible locally — `ph vetra` runs inside the project, so the
// import resolves against node_modules/@electric-sql/pglite where the real
// tarball sits. It only shows up on a deployed Switchboard loading the published
// package, where CREATE EXTENSION vector fails, `note_embeddings` is never
// created, and every embedding query dies with:
//
//   relation "note_embeddings" does not exist
//
// Copying the tarball to the path the shim already expects fixes it without
// patching the upstream build config.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

function resolvePgliteDist() {
  // Resolve through the package's own entry so this keeps working if the
  // dependency is hoisted, nested, or linked.
  try {
    return dirname(require.resolve("@electric-sql/pglite"));
  } catch {
    return null;
  }
}

const distRoot = "dist";
if (!existsSync(distRoot)) {
  console.error("[pglite-assets] no dist/ — run the build first");
  process.exit(1);
}

const pgliteDist = resolvePgliteDist();
if (!pgliteDist) {
  console.error(
    "[pglite-assets] cannot resolve @electric-sql/pglite. It must be a real " +
      "dependency (not just a devDependency) so consumers install it too.",
  );
  process.exit(1);
}

const ASSETS = ["vector.tar.gz"];
let copied = 0;

for (const name of ASSETS) {
  const from = join(pgliteDist, name);
  if (!existsSync(from)) {
    console.error(`[pglite-assets] missing in pglite dist: ${from}`);
    process.exit(1);
  }
  // dist/node/<shim>.mjs resolves "../vector.tar.gz" → dist/vector.tar.gz
  const to = join(distRoot, name);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`[pglite-assets] ${name} → ${to} (${statSync(to).size} bytes)`);
  copied++;
}

console.log(`[pglite-assets] ok — ${copied} asset(s) shipped with dist/`);
