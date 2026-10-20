// Standalone spike harness: npx vite --config spike/llm-harness/vite.config.mjs --port 5199
import { writeFileSync } from "node:fs";
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

export default defineConfig({
  root,
  // The harness root has no tsconfig, so point the plugin at the repo's.
  plugins: [
    tsconfigPaths({ root: repo, projects: [`${repo}tsconfig.json`] }),
    saveResults,
  ],
  // No HMR: a reload would drop a loaded model and in-page results.
  server: { port: 5199, strictPort: true, hmr: false, fs: { allow: [repo] } },
});
