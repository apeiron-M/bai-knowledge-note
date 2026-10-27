/**
 * Connect plan Phase 3 browser check: the shipped configuration C core on
 * the shipped wllama clients (loadLlm + loadDecisionModel), WebGPU, over
 * the dev-only parity items. Driven from devtools:
 *   window.__cParity.start("branch") … then poll window.__cParity.state
 */
import { decideOp } from "../../editors/knowledge-vault/chat/core/c-pipeline.js";
import {
  loadDecisionModel,
  loadLlm,
  type DecisionClient,
  type LlmClient,
} from "../../editors/knowledge-vault/chat/core/llm-client.js";
import { answerTableMismatch, type TrieMode } from "../../editors/knowledge-vault/chat/core/lora-trie.js";
import { artifactMismatch, C_ARTIFACTS, C_LOAD } from "../../editors/knowledge-vault/chat/core/model-manifest.js";
import { v1Catalog } from "../../editors/knowledge-vault/chat/core/v1-pipeline.js";
import { runParityC, type ParityReport } from "../../editors/knowledge-vault/chat/dev/parity-c.js";

const state: {
  busy: boolean;
  error: string | null;
  load: Record<string, unknown> | null;
  e2e: Record<string, unknown>[];
  report: ParityReport | null;
} = { busy: false, error: null, load: null, e2e: [], report: null };
let lora: LlmClient | null = null;
let kev: DecisionClient | null = null;

/** Load settings; default: the shipped ones (C_LOAD). Override before the first load. */
interface LoadOpts { nCtx?: number; nBatch?: number; nUbatch?: number }
const loadOpts: { lora: LoadOpts; kev: LoadOpts } = { lora: { ...C_LOAD.lora }, kev: { ...C_LOAD.kev } };

async function ensure(): Promise<{ lora: LlmClient; kev: DecisionClient }> {
  if (!lora) lora = await loadLlm({ backend: "webgpu", modelUrl: `/x5/${C_ARTIFACTS.lora.fileName}`, jinja: false, ...loadOpts.lora });
  if (!kev) kev = await loadDecisionModel({ backend: "webgpu", modelUrl: `/kevft/${C_ARTIFACTS.kev.fileName}`, ...loadOpts.kev });
  const li = lora.info;
  const ki = kev.info;
  state.load = {
    opts: loadOpts,
    lora: { loadMs: Math.round(li.loadMs), gpuLayers: li.gpuLayers, multithread: li.multithread, bytes: li.downloadBytes,
      mismatch: artifactMismatch(C_ARTIFACTS.lora, { bytes: li.downloadBytes, meta: li.meta, nVocab: li.nVocab }),
      table: answerTableMismatch({ pre: li.meta["tokenizer.ggml.pre"], nVocab: li.nVocab, bos: li.bos, eos: li.eos }) },
    kev: { loadMs: Math.round(ki.loadMs), gpuLayers: ki.gpuLayers, bytes: ki.downloadBytes,
      mismatch: artifactMismatch(C_ARTIFACTS.kev, { bytes: ki.downloadBytes, meta: ki.meta }) },
  };
  return { lora, kev };
}

async function run(mode: TrieMode): Promise<void> {
  const m = await ensure();
  const k = m.kev;
  // end-to-end decideOp on a gated, a confident and a no-action utterance
  for (const [docType, u] of [
    ["bai/knowledge-note", "tag this note with eventual consistency"],
    ["bai/knowledge-note", "what is this note about?"],
  ]) {
    const d = await decideOp(u, docType, { catalog: v1Catalog(), lora: m.lora, kev: () => Promise.resolve(k) });
    state.e2e.push(d.kind === "none" ? { u, kind: "none", timings: d.timings } : { u, kind: "op", config: d.config, pick: d.pick.key, asked: d.asked, offered: d.offered.map((e) => e.key), margin: d.margin, timings: d.timings, trie: d.trie });
  }
  state.report = await runParityC(m, { mode });
}

function start(mode: TrieMode = "branch"): string {
  if (state.busy) return "busy";
  state.busy = true;
  state.error = null;
  void run(mode)
    .catch((e: unknown) => {
      state.error = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    })
    .finally(() => {
      state.busy = false;
    });
  return `started ${mode}`;
}

declare global {
  interface Window {
    __cParity: {
      start: typeof start;
      state: typeof state;
      loadOpts: typeof loadOpts;
      load: () => Promise<unknown>;
      clients: () => { lora: LlmClient | null; kev: DecisionClient | null };
    };
  }
}
/** Memory checks: set loadOpts, then load() (models only) or start(). */
window.__cParity = { start, state, loadOpts, load: async () => (await ensure(), state.load), clients: () => ({ lora, kev }) };
