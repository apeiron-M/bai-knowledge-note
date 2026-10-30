/**
 * Configuration C: canonical LFM2 token ids of every step-1 answer, plus the
 * native goldens the browser trie depends on. Run against a native
 * llama-server at the wllama pin (46ca246) serving the shipped LoRA with
 * `-c 4096 -np 1 --no-jinja`:
 *
 *   LLAMA_URL=http://127.0.0.1:<port> X5_GGUF=<path> \
 *     tsx scripts/chat/gen-answer-tokens.mts
 *
 * The generator moved to nl-runtime (`packages/nl-runtime/scripts/`) in M1:
 * the answer table is per tokenizer and nl-runtime bundles it. This wrapper
 * runs it from the sibling powerhouse-nl checkout (the injected package
 * ships `dist` and `vendor` only) with the vault's catalog and fixtures (it
 * reads gguf_meta.py from powerhouse-nl's python/nl_train). It
 * writes the table into nl-runtime's `src/core/answer-tokens.lfm2.json`
 * (set ANSWER_TABLE_OUT to write elsewhere), and
 * tests/fixtures/chat-c/template-goldens.json and retok-check.json here.
 */
import { spawnSync } from "node:child_process";

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const SCRIPT = `${REPO}/../powerhouse-nl/packages/nl-runtime/scripts/gen-answer-tokens.mts`;
const env = {
  ...process.env,
  X5_GGUF:
    process.env.X5_GGUF ??
    `${REPO}/training/artifacts/m2bv-350m/gguf/LFM2.5-350M-vault-m2bv-20261029-Q4_K_M.gguf`,
  CATALOG_MODULE: `${REPO}/editors/knowledge-vault/chat/core/catalog-models.ts`,
  CATALOG_EXPORT: "v1Catalog",
  FIXTURES_DIR: `${REPO}/tests/fixtures/chat-c`,
};
const r = spawnSync("npx", ["tsx", SCRIPT], { env, stdio: "inherit" });
process.exit(r.status ?? 1);
