/**
 * Node parity of configuration C's core modules against the committed dev
 * oracle (tests/fixtures/chat-c, held-out-3 + held-out-4 only), on native
 * llama-server at the wllama pin:
 *
 *   npm run chat:parity-c            # starts both servers on free ports
 *   LORA_URL=... KEV_URL=... npm run chat:parity-c   # or uses running ones
 *
 * The harness moved to nl-runtime/dev (`runParityC`) in M1, with the same
 * bars and env variables (LLAMA_SERVER, LORA_URL, KEV_URL, PARITY_ONLY,
 * PARITY_OUT, PARITY_TRIE_TOL). This wrapper passes the vault's fixtures,
 * GGUFs, catalog, artifact manifest and tables, and nl-eval's evaluator for
 * the metrics check (until M5 the old rig's evaluate.py, which wrote the
 * oracle's metrics; on the oracle both give the same gate block). Writes a summary + per-item
 * diffs to $PARITY_OUT (default $TMPDIR/parity-c), never into the repo.
 * Exit 0 = PARITY OK, 1 = diffs, 3 = a server returned 429.
 */
import { assemble, evaluate } from "nl-eval";
import { runParityC } from "nl-runtime/dev";
import { v1Catalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import { C_ARTIFACTS } from "../../editors/knowledge-vault/chat/core/model-manifest.js";
import { OP_DESCRIPTIONS } from "../../editors/knowledge-vault/chat/core/op-descriptions.js";
import {
  CURRENT_LISTS,
  REF_EXTRACTORS,
  STATE_CHOICES,
} from "../../editors/knowledge-vault/chat/core/ref-candidates.js";
import { VAULT_ARTIFACTS } from "../../editors/knowledge-vault/chat/vault-artifacts.js";

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

const r = await runParityC({
  fixturesDir: `${REPO}/tests/fixtures/chat-c`,
  loraGguf: `${REPO}${C_ARTIFACTS.lora.devPath}`,
  kevGguf: `${REPO}${C_ARTIFACTS.kev.devPath}`,
  catalog: v1Catalog(),
  manifest: VAULT_ARTIFACTS,
  tables: {
    refExtractors: REF_EXTRACTORS,
    stateChoices: STATE_CHOICES,
    currentLists: CURRENT_LISTS,
    opDescriptions: OP_DESCRIPTIONS,
  },
  gateMetrics: (run, tLora, tKev) => {
    const { rows, missing, levels } = assemble(run);
    if (missing.length) throw new Error(`parity run is missing ${missing.length} rows`);
    return evaluate(rows, tLora, tKev, levels).configs.gate;
  },
  llamaServer: `${process.env.HOME}/.cache/bai-training/llama.cpp/build/bin/llama-server`,
});
process.exit(r.exitCode);
