// Standalone spike harness: npx vite --config spike/llm-harness/vite.config.mjs --port 5199
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const root = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root,
  // The harness root has no tsconfig, so point the plugin at the repo's.
  plugins: [tsconfigPaths({ root: repo, projects: [`${repo}tsconfig.json`] })],
  // No HMR: a reload would drop a loaded model and in-page results.
  server: { port: 5199, strictPort: true, hmr: false, fs: { allow: [repo] } },
});
