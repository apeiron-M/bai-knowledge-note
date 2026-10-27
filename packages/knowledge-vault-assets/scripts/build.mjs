// Assemble dist/: what @powerhousedao/knowledge-note's embedder loads, in the
// layout its CDN loader expects (`<base>models/`, `<base>wasm/`,
// `<base>transformers.web.bundle.mjs`).
//
// The runtime comes from the vault repository's node_modules, so its versions
// are the ones the vault's bun.lock pins. Every input is checked: a package
// that would only fail once deployed is never built.
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const MODEL = "Supabase/gte-small";
const DTYPE = "q8";

function fail(msg) {
  console.error(`[vault-assets] ${msg}`);
  process.exit(1);
}

/** The first `<dir>/<rel>` that exists, from this package up to the filesystem root. */
function findUp(rel) {
  for (let dir = root; ; dir = dirname(dir)) {
    const p = join(dir, rel);
    if (existsSync(p)) return p;
    if (dirname(dir) === dir) return null;
  }
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

// 1. The model: committed in models/, copied as is.
const modelProbe = join(root, "models", MODEL, "onnx", "model_quantized.onnx");
if (!existsSync(modelProbe)) fail(`missing ${modelProbe}: run node scripts/fetch-model.mjs`);
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, "models"), join(dist, "models"), { recursive: true });
console.log(`[vault-assets] model → dist/models (${mb(statSync(modelProbe).size)} onnx)`);

// 2. The ONNX runtime's wasm and its loader. Hoisted first, then nested under
//    transformers: both packages restrict their exports maps, so locate by path.
const transformersDir = findUp(join("node_modules", "@huggingface", "transformers"));
if (!transformersDir) fail("cannot find @huggingface/transformers in node_modules: run bun install in the vault repository");
const ortDist =
  findUp(join("node_modules", "onnxruntime-web", "dist")) ??
  [join(transformersDir, "node_modules", "onnxruntime-web", "dist")].find(existsSync);
if (!ortDist) fail("cannot find onnxruntime-web/dist (a dependency of @huggingface/transformers)");
mkdirSync(join(dist, "wasm"));
for (const f of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"]) {
  const from = join(ortDist, f);
  if (!existsSync(from)) fail(`missing ${from}`);
  copyFileSync(from, join(dist, "wasm", f));
}
console.log(`[vault-assets] onnxruntime wasm → dist/wasm (${mb(statSync(join(dist, "wasm", "ort-wasm-simd-threaded.asyncify.wasm")).size)})`);

// 3. transformers.js, web build, with its onnxruntime imports inlined: the
//    embedder imports it through a data: URL, where a bare import cannot resolve.
const webBuild = join(transformersDir, "dist", "transformers.web.js");
if (!existsSync(webBuild)) fail(`missing ${webBuild}`);
const { rolldown } = await import("rolldown");
const bundleFile = join(dist, "transformers.web.bundle.mjs");
const bundle = await rolldown({ input: webBuild, platform: "browser", logLevel: "silent" });
await bundle.write({ file: bundleFile, format: "esm", codeSplitting: false, sourcemap: false });
await bundle.close();
const bundled = statSync(bundleFile).size;
if (bundled < 1_000_000) fail(`transformers.web.bundle.mjs suspiciously small (${bundled} bytes)`);
if (/^\s*import\s[^;]*from\s*["'][^./]/m.test(readFileSync(bundleFile, "utf8"))) fail("transformers.web.bundle.mjs still has a bare import");
console.log(`[vault-assets] transformers web bundle → dist/transformers.web.bundle.mjs (${mb(bundled)})`);

// 4. What this build was made from.
const version = (dir) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
const manifest = {
  model: MODEL,
  dtype: DTYPE,
  dimensions: 384,
  transformers: version(transformersDir),
  onnxruntimeWeb: version(dirname(ortDist)),
};
writeFileSync(join(dist, "assets.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[vault-assets] ok: ${JSON.stringify(manifest)}`);
