// Standalone spike harness: npx vite --config spike/llm-harness/vite.config.mjs --port 5199
import {
  createReadStream,
  existsSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const root = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("../..", import.meta.url));

/** Dev-only `POST /__save?name=x` writes the body to `eval/x.json`. */
const saveResults = {
  name: "spike-save-results",
  configureServer(server) {
    server.middlewares.use("/__save", (req, res) => {
      const name = new URL(req.url ?? "", "http://x").searchParams.get("name");
      if (req.method !== "POST" || !name || !/^[\w.-]+$/.test(name)) {
        res.statusCode = 400;
        res.end();
        return;
      }
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        writeFileSync(`${root}eval/${name}.json`, Buffer.concat(chunks));
        res.end("ok");
      });
    });
  },
};

// transformers' own onnxruntime-web (a pnpm sibling, not hoisted).
const ORT_DIST = join(
  realpathSync(`${repo}node_modules/@huggingface/transformers`),
  "../../onnxruntime-web/dist",
);
const TYPES = {
  ".json": "application/json",
  ".onnx": "application/octet-stream",
  ".wasm": "application/wasm",
  ".mjs": "text/javascript",
};

/**
 * Dev-only static mounts: `/models/` (gte-small), `/ort/` (ort wasm) and
 * `/lora/` (round 8: locally exported fine-tune GGUFs, gitignored) and
 * `/lora10/` (round 10's).
 */
const staticMounts = {
  name: "spike-static-mounts",
  configureServer(server) {
    for (const [prefix, dir] of [
      ["/models/", `${repo}models/`],
      ["/ort/", `${ORT_DIST}/`],
      ["/lora/", `${repo}training/artifacts/round8/gguf/`],
      ["/lora10/", `${repo}training/artifacts/round10/gguf/`],
      // Connect plan phase 0: configuration C's two GGUFs (gitignored) and
      // the spike's native fixtures (outside the repo, via PHASE0_FIXTURES).
      ["/x5/", `${repo}training/artifacts/x5-350m/gguf/`],
      ["/kevft/", `${repo}training/artifacts/kev-ft/gguf/`],
      ...(process.env.PHASE0_FIXTURES
        ? [["/c-spike/", `${process.env.PHASE0_FIXTURES.replace(/\/$/, "")}/`]]
        : []),
    ]) {
      server.middlewares.use(prefix, (req, res, next) => {
        const rel = normalize(
          decodeURIComponent((req.url ?? "").split("?")[0]),
        );
        const file = join(dir, rel);
        if (!file.startsWith(dir) || !existsSync(file)) return next();
        const ext = file.slice(file.lastIndexOf("."));
        res.setHeader("Content-Type", TYPES[ext] ?? "application/octet-stream");
        res.setHeader("Content-Length", String(statSync(file).size));
        // Streamed: the Kev GGUF is 530 MB.
        createReadStream(file).pipe(res);
      });
    }
  },
};

export default defineConfig({
  root,
  // The harness root has no tsconfig, so point the plugin at the repo's.
  plugins: [
    tsconfigPaths({ root: repo, projects: [`${repo}tsconfig.json`] }),
    saveResults,
    staticMounts,
  ],
  // No HMR: a reload would drop a loaded model and in-page results.
  server: {
    port: 5199,
    strictPort: true,
    hmr: false,
    fs: { allow: [repo] },
    // PHASE0_COI=1: cross-origin isolation (multithread wasm and
    // performance.measureUserAgentSpecificMemory); everything is same-origin.
    headers: process.env.PHASE0_COI
      ? {
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "require-corp",
        }
      : {},
  },
});
