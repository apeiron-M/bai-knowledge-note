/**
 * Configuration C's two models, once per page: the X5 LoRA loads on the
 * first message, Kev-FT on the first message that targets a document (its
 * first need), each in its own wllama instance. Switching tabs must not
 * reload them, so they live in this module with a small store the hook
 * subscribes to.
 */
import {
  clearModelCache,
  loadDecisionModel,
  loadLlm,
  type DecisionClient,
  type LlmClient,
  type LlmInfo,
} from "../chat/core/llm-client.js";
import type { KevBackend } from "../chat/core/decision-backend.js";
import { answerTableMismatch } from "../chat/core/lora-trie.js";
import { artifactMismatch, C_ARTIFACTS, C_LOAD } from "../chat/core/model-manifest.js";
import type { ResolvedModel } from "../chat/core/model-source.js";
import type { ScoreCache } from "../chat/core/op-scorer.js";
import type { WllamaAssetOptions } from "nl-runtime";

/**
 * Dev toggle: `localStorage["bai.chat.forceCompat"] = "1"` runs wllama's
 * compat build (no JSPI / memory64) even where the browser has both, to
 * exercise that path (E1: its wasm must come from this origin, not a CDN).
 */
function wllamaAssets(): WllamaAssetOptions {
  try {
    return globalThis.localStorage.getItem("bai.chat.forceCompat") === "1"
      ? { forceCompat: true }
      : {};
  } catch {
    return {};
  }
}

export type ModelPhase =
  | "idle"
  | "downloading"
  | "loading"
  | "ready"
  | "error"
  | "off";

export interface ModelState {
  phase: ModelPhase;
  /** Download progress 0..1. */
  progress: number;
  error: string | null;
  info: LlmInfo | null;
  /** Why the loaded file is not the measured artifact (null if it is). */
  mismatch: string | null;
}

export type ChatStage = "choose" | "score" | "wait-kev" | "fill" | "answer";

export interface ChatModelsState {
  lora: ModelState;
  kev: ModelState;
  stage: ChatStage | null;
  /** Kev calls that failed in a row (2 disable Kev for the page). */
  kevFailures: number;
}

const IDLE: ModelState = {
  phase: "idle",
  progress: 0,
  error: null,
  info: null,
  mismatch: null,
};

let state: ChatModelsState = {
  lora: IDLE,
  kev: IDLE,
  stage: null,
  kevFailures: 0,
};
const listeners = new Set<() => void>();

function update(patch: Partial<ChatModelsState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function updateModel(role: "lora" | "kev", patch: Partial<ModelState>): void {
  update({ [role]: { ...state[role], ...patch } });
}

export function subscribeChatModels(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function chatModelsState(): ChatModelsState {
  return state;
}

export function setChatStage(stage: ChatStage | null): void {
  if (state.stage !== stage) update({ stage });
}

export function hasWebGpu(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function progressFor(role: "lora" | "kev") {
  return (loaded: number, total: number) => {
    const p = total ? loaded / total : 0;
    updateModel(role, {
      phase: p >= 1 ? "loading" : "downloading",
      progress: p,
    });
  };
}

/** Ask once that cached GGUFs (OPFS) are not evicted under pressure. */
let persistAsked = false;
async function requestPersistentStorage(): Promise<void> {
  if (persistAsked || typeof navigator === "undefined") return;
  persistAsked = true;
  try {
    await navigator.storage.persist();
  } catch {
    // not supported or denied: the cache may be evicted
  }
}

/* ------------------------------- LoRA -------------------------------- */

interface LoadedLora {
  key: string;
  client: Promise<LlmClient>;
  /** Content-free ref-scoring requests depend on the model. */
  cache: ScoreCache;
}
let lora: LoadedLora | null = null;

/** Why the LoRA cannot score the trie (tokenizer differs), else null. */
export function loraTrieBlocker(info: LlmInfo | null): string | null {
  if (!info) return null;
  return answerTableMismatch({
    pre: info.meta["tokenizer.ggml.pre"],
    nVocab: info.nVocab,
    bos: info.bos,
    eos: info.eos,
  });
}

export async function ensureLora(
  src: ResolvedModel,
): Promise<{ client: LlmClient; cache: ScoreCache }> {
  if (lora?.key !== src.key) {
    const old = lora;
    updateModel("lora", { ...IDLE, phase: "downloading" });
    lora = {
      key: src.key,
      cache: new Map(),
      client: (async () => {
        if (old) await (await old.client.catch(() => null))?.exit();
        if (src.matchesManifest) await requestPersistentStorage();
        return loadLlm({
          backend: hasWebGpu() ? "webgpu" : "cpu",
          modelUrl: src.url,
          useCache: src.matchesManifest,
          jinja: false,
          ...C_LOAD.lora,
          ...wllamaAssets(),
          onProgress: progressFor("lora"),
        });
      })(),
    };
    const mine = lora;
    mine.client.then(
      (c) => {
        if (lora !== mine) return;
        const mismatch = artifactMismatch(C_ARTIFACTS.lora, {
          bytes: c.info.downloadBytes,
          meta: c.info.meta,
          nVocab: c.info.nVocab,
        });
        updateModel("lora", { phase: "ready", progress: 1, info: c.info, mismatch });
      },
      (err: unknown) => {
        if (lora !== mine) return;
        lora = null;
        updateModel("lora", { phase: "error", error: errText(err) });
      },
    );
  }
  const mine = lora;
  return { client: await mine.client, cache: mine.cache };
}

/* -------------------------------- Kev -------------------------------- */

interface LoadedKev {
  key: string;
  client: Promise<DecisionClient>;
}
let kev: LoadedKev | null = null;

/** Why Kev cannot run at all right now, else null. */
export function kevBlocker(enabled: boolean): string | null {
  if (!enabled) return "off";
  if (!hasWebGpu())
    return "no WebGPU (the decision model on CPU takes seconds per call)";
  if (state.kevFailures >= 2) return "failed twice on this page";
  return null;
}

/** Kev, loading it on first call; rejects when it is not usable. */
export function ensureKev(src: ResolvedModel): Promise<DecisionClient> {
  if (kev?.key !== src.key) {
    const old = kev;
    updateModel("kev", { ...IDLE, phase: "downloading" });
    const mine: LoadedKev = {
      key: src.key,
      client: (async () => {
        if (old) await (await old.client.catch(() => null))?.exit();
        const c = await loadDecisionModel({
          backend: "webgpu",
          modelUrl: src.url,
          useCache: src.matchesManifest,
          ...C_LOAD.kev,
          ...wllamaAssets(),
          onProgress: progressFor("kev"),
        });
        const off = c.info.gpuLayers;
        const why =
          off && off.offloaded < off.total
            ? `only ${off.offloaded}/${off.total} layers on WebGPU`
            : c.info.meta[`${C_ARTIFACTS.kev.arch}.decision.type`] === undefined
              ? "not a decision model (no decision head)"
              : null;
        if (why) {
          await c.exit();
          throw new Error(why);
        }
        return c;
      })(),
    };
    kev = mine;
    mine.client.then(
      (c) => {
        if (kev !== mine) return;
        const mismatch = artifactMismatch(C_ARTIFACTS.kev, {
          bytes: c.info.downloadBytes,
          meta: c.info.meta,
        });
        updateModel("kev", { phase: "ready", progress: 1, info: c.info, mismatch });
      },
      (err: unknown) => {
        if (kev !== mine) return;
        updateModel("kev", { phase: "error", error: errText(err) });
      },
    );
  }
  return kev.client;
}

/** llama-server's errors for a request over Kev's n_batch / n_ctx. */
export function isKevTooLong(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /too large to process|exceeds the available context size/i.test(msg);
}

/** The KevBackend for one turn (tracks consecutive failures). */
export function kevBackendFor(src: ResolvedModel): () => Promise<KevBackend> {
  return async () => {
    const c = await ensureKev(src);
    return {
      systemOne: async (body) => {
        try {
          const r = await c.systemOne(body);
          if (state.kevFailures) update({ kevFailures: 0 });
          return r;
        } catch (err) {
          // a request too long for Kev's context is not a broken Kev
          if (!isKevTooLong(err)) update({ kevFailures: state.kevFailures + 1 });
          throw err;
        }
      },
    };
  };
}

/** Kev's served temperature: the manifest's, or a custom file's own. */
export function kevServedT(): number {
  const meta = state.kev.info?.meta;
  const t = Number(meta?.[`${C_ARTIFACTS.kev.arch}.decision.temperature.choice`]);
  const manifest = C_ARTIFACTS.kev.servedT ?? 1;
  return state.kev.mismatch && Number.isFinite(t) && t > 0 ? t : manifest;
}

/** Free Kev's worker, wasm heap and GPU buffers. */
export async function unloadKev(off: boolean): Promise<void> {
  const old = kev;
  kev = null;
  update({ kev: { ...IDLE, phase: off ? "off" : "idle" }, kevFailures: 0 });
  if (old) await (await old.client.catch(() => null))?.exit();
}

/** Forget a failed Kev load so the next message retries it. */
export function resetKevError(): void {
  if (state.kev.phase === "error") {
    kev = null;
    update({ kev: IDLE, kevFailures: 0 });
  }
}

export function markKevOff(): void {
  if (!kev) updateModel("kev", { ...IDLE, phase: "off" });
}

export { clearModelCache };
