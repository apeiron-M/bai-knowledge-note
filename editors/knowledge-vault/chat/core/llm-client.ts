import type { LoraBackend } from "./decision-backend.js";
import type { SystemOneBody, SystemOneResponse } from "./kev-request.js";
import {
  asSystemOneResponse,
  gpuOffload,
  NativeLog,
  withNativeLog,
  wllamaForcedLogprob,
  wllamaNextDist,
} from "./wllama-backend.js";
import type {
  WllamaChatMessage,
  WllamaChatParams,
  WllamaLogprobContent,
  WllamaInstance,
  WllamaModule,
  WllamaResponseFormat,
  WllamaTimings,
} from "./wllama-types.js";

export const WLLAMA_VERSION = "3.8.1";

/**
 * The vendored wllama wasm (`vendor/wllama/3.8.1/`). The browser build emits
 * it as a hashed asset next to the package chunks and Vite dev serves it from
 * the repo, so it comes from the same origin as this code either way.
 */
function wllamaWasmUrl(): string {
  return new URL("../../../../vendor/wllama/3.8.1/wllama.wasm", import.meta.url)
    .href;
}

export const DEFAULT_MODEL = {
  repo: "LiquidAI/LFM2.5-350M-GGUF",
  file: "LFM2.5-350M-Q4_K_M.gguf",
};

export type LlmBackend = "webgpu" | "cpu";

export interface LoadLlmOptions {
  backend: LlmBackend;
  onProgress?: (loaded: number, total: number) => void;
  /**
   * Use the GGUF's jinja chat template via llama.cpp's minja. Default
   * false: the legacy template, as every measured run (`--no-jinja`).
   */
  jinja?: boolean;
  nCtx?: number;
  model?: { repo: string; file: string };
  /** Load this GGUF URL instead of `model`. */
  modelUrl?: string;
  /**
   * Keep a URL model in the OPFS cache (default false, so a re-exported
   * file under the same URL is never served stale). Only for versioned,
   * immutable file names (the configuration C manifest).
   */
  useCache?: boolean;
  /** Collect native llama.cpp log lines (for debugging load failures). */
  onLog?: (level: string, line: string) => void;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  seed?: number;
  responseFormat?: WllamaResponseFormat;
  grammar?: string;
  timingsPerToken?: boolean;
  onDelta?: (delta: string) => void;
}

export interface ChatResult {
  text: string;
  chunks: number;
  finishReason: string | null;
  /** From the last chunk that carried `timings`. */
  timings?: WllamaTimings;
  /** Whether that was the very last chunk. */
  timingsOnLastChunk: boolean;
  wallMs: number;
}

export type JsonConstraint =
  | { kind: "json_schema"; name: string; schema: unknown }
  | { kind: "grammar"; grammar: string };

export interface JsonResult extends ChatResult {
  parsed: unknown;
  parseError?: string;
}

export type CompleteJson = (
  messages: WllamaChatMessage[],
  constraint: JsonConstraint,
  opts?: Omit<ChatOptions, "responseFormat" | "grammar">,
) => Promise<JsonResult>;

export interface ScoreOptions {
  maxTokens?: number;
  /** Alternatives reported per position (llama.cpp `n_probs`). */
  topLogprobs?: number;
}

export interface ScoreResult {
  text: string;
  /** One entry per generated token, as llama.cpp reports them. */
  tokens: WllamaLogprobContent[];
  finishReason: string | null;
  timings?: WllamaTimings;
  wallMs: number;
}

/**
 * Non-streaming greedy completion under `grammar` with per-token logprobs.
 * With a single-literal grammar this forces a continuation; its logprobs are
 * the model's unconstrained (pre-grammar) token probabilities.
 */
export type ScoreText = (
  messages: WllamaChatMessage[],
  grammar: string,
  opts?: ScoreOptions,
) => Promise<ScoreResult>;

export interface LlmInfo {
  libllamaVersion: string;
  wllamaVersion: string;
  backend: LlmBackend;
  webgpu: boolean;
  multithread: boolean;
  threads: number;
  loadMs: number;
  downloadBytes: number;
  nCtx: number;
  jinja: boolean;
  model: { repo: string; file: string };
  hasChatTemplate: boolean;
  /** GGUF metadata (string values). */
  meta: Record<string, string | undefined>;
  nVocab: number;
  bos: number;
  eos: number;
  /** From llama.cpp's load log; null if not logged. */
  gpuLayers: { offloaded: number; total: number } | null;
  useCache: boolean;
}

export interface LlmClient extends LoraBackend {
  chatStream(
    messages: WllamaChatMessage[],
    opts?: ChatOptions,
  ): Promise<ChatResult>;
  info: LlmInfo;
  exit(): Promise<void>;
}

/** Kev-FT (a System One decision model) in its own wllama instance. */
export interface DecisionClient {
  systemOne(body: SystemOneBody): Promise<SystemOneResponse>;
  info: LlmInfo;
  exit(): Promise<void>;
}

function isWllamaModule(m: unknown): m is WllamaModule {
  return (
    typeof m === "object" &&
    m !== null &&
    "Wllama" in m &&
    typeof m.Wllama === "function"
  );
}

let modulePromise: Promise<WllamaModule> | null = null;

/**
 * Import the vendored wllama ESM (cached per page). The bundler turns this
 * relative import into a lazy chunk of the package, which Connect's CSP
 * (`script-src 'self' …`) allows — a CDN import is blocked there.
 */
export function importWllama(): Promise<WllamaModule> {
  modulePromise ??= import("../../../../vendor/wllama/3.8.1/wllama.js")
    .then((mod: unknown) => {
      if (!isWllamaModule(mod))
        throw new Error("wllama ESM has no Wllama export");
      return mod;
    })
    .catch((err: unknown) => {
      modulePromise = null;
      throw err;
    });
  return modulePromise;
}

/** libllama version and wllama's WebGPU check, without loading a model. */
export async function probeWllama(): Promise<{
  libllamaVersion: string;
  isSupportWebGPU: boolean;
}> {
  const { Wllama } = await importWllama();
  const probe = new Wllama({ default: wllamaWasmUrl() });
  return {
    libllamaVersion: Wllama.getLibllamaVersion(),
    isSupportWebGPU: probe.isSupportWebGPU(),
  };
}

async function runChat(
  wllama: WllamaInstance,
  messages: WllamaChatMessage[],
  opts: ChatOptions,
): Promise<ChatResult> {
  const params: WllamaChatParams = {
    messages,
    stream: true,
    max_tokens: opts.maxTokens ?? 256,
    temperature: opts.temperature ?? 0,
    seed: opts.seed,
    response_format: opts.responseFormat,
    grammar: opts.grammar,
    timings_per_token: opts.timingsPerToken,
  };
  const t0 = performance.now();
  const stream = await wllama.createChatCompletion(params);
  let text = "";
  let chunks = 0;
  let finishReason: string | null = null;
  let timings: WllamaTimings | undefined;
  let timingsOnLastChunk = false;
  for await (const chunk of stream) {
    chunks++;
    const choice = chunk.choices.at(0);
    const delta = choice?.delta.content ?? "";
    if (delta) {
      text += delta;
      opts.onDelta?.(delta);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    timingsOnLastChunk = chunk.timings !== undefined;
    if (chunk.timings) timings = chunk.timings;
  }
  return {
    text,
    chunks,
    finishReason,
    timings,
    timingsOnLastChunk,
    wallMs: performance.now() - t0,
  };
}

interface LoadedWllama {
  wllama: WllamaInstance;
  info: LlmInfo;
  log: NativeLog;
}

async function loadWllama(opts: LoadLlmOptions): Promise<LoadedWllama> {
  const { Wllama } = await importWllama();
  const model = opts.model ?? DEFAULT_MODEL;
  const nCtx = opts.nCtx ?? 4096;
  const jinja = opts.jinja ?? false;
  const useCache = opts.modelUrl ? (opts.useCache ?? false) : true;
  // Always captured (wllama errors carry no cause), forwarded on request.
  const log = new NativeLog(60, opts.onLog);
  const wllama = new Wllama({ default: wllamaWasmUrl() }, { logger: log.logger() });
  let downloadBytes = 0;
  const t0 = performance.now();
  const params = {
    n_ctx: nCtx,
    n_parallel: 1,
    n_gpu_layers: opts.backend === "webgpu" ? 99999 : 0,
    jinja,
    progressCallback: ({ loaded, total }: { loaded: number; total: number }) => {
      downloadBytes = total;
      opts.onProgress?.(loaded, total);
    },
  };
  const what = `load ${opts.modelUrl ?? `${model.repo}/${model.file}`}`;
  try {
    await withNativeLog(log, what, async () => {
      if (opts.modelUrl)
        await wllama.loadModelFromUrl(opts.modelUrl, { ...params, useCache });
      else await wllama.loadModelFromHF(model, params);
    });
  } catch (err) {
    await wllama.exit().catch(() => undefined);
    throw err;
  }
  const loadMs = performance.now() - t0;
  const meta = wllama.getModelMetadata();
  const ctx = wllama.getLoadedContextInfo();
  const info: LlmInfo = {
    libllamaVersion: Wllama.getLibllamaVersion(),
    wllamaVersion: WLLAMA_VERSION,
    backend: opts.backend,
    webgpu: wllama.isSupportWebGPU(),
    multithread: wllama.isMultithread(),
    threads: wllama.getNumThreads(),
    loadMs,
    downloadBytes,
    nCtx,
    jinja,
    model: opts.modelUrl ? { repo: "url", file: opts.modelUrl } : model,
    hasChatTemplate: wllama.getChatTemplate() !== null,
    meta: meta.meta,
    nVocab: meta.hparams.nVocab,
    bos: ctx.token_bos,
    eos: ctx.token_eos,
    gpuLayers: gpuOffload(log.offloadLine),
    useCache,
  };
  return { wllama, info, log };
}

export async function loadLlm(opts: LoadLlmOptions): Promise<LlmClient> {
  const { wllama, info, log } = await loadWllama(opts);

  const completeJson: CompleteJson = async (messages, constraint, o = {}) => {
    const result = await runChat(wllama, messages, {
      ...o,
      responseFormat:
        constraint.kind === "json_schema"
          ? {
              type: "json_schema",
              json_schema: {
                name: constraint.name,
                schema: constraint.schema,
                strict: true,
              },
            }
          : undefined,
      grammar: constraint.kind === "grammar" ? constraint.grammar : undefined,
    });
    try {
      const parsed: unknown = JSON.parse(result.text);
      return { ...result, parsed };
    } catch (err) {
      return {
        ...result,
        parsed: undefined,
        parseError: err instanceof Error ? err.message : "parse error",
      };
    }
  };

  const scoreText: ScoreText = async (messages, grammar, o = {}) => {
    const t0 = performance.now();
    const res = await wllama.createChatCompletion({
      messages,
      stream: false,
      max_tokens: o.maxTokens ?? 48,
      temperature: 0,
      // An empty grammar means unconstrained greedy decoding.
      grammar: grammar || undefined,
      logprobs: true,
      top_logprobs: o.topLogprobs ?? 1,
    });
    const choice = res.choices.at(0);
    return {
      text: choice?.message.content ?? "",
      tokens: choice?.logprobs?.content ?? [],
      finishReason: choice?.finish_reason ?? null,
      timings: res.timings,
      wallMs: performance.now() - t0,
    };
  };

  return {
    chatStream: (messages, o = {}) => runChat(wllama, messages, o),
    completeJson,
    scoreText,
    nextDist: (prompt, nProbs) =>
      withNativeLog(log, "next-token logprobs", () =>
        wllamaNextDist(wllama, prompt, nProbs),
      ),
    forcedLogprob: (prompt, id) =>
      withNativeLog(log, "forced logprob", () =>
        wllamaForcedLogprob(wllama, prompt, id),
      ),
    info,
    exit: () => wllama.exit(),
  };
}

/**
 * Load a System One decision model (Kev-FT) from a URL. Callers check
 * `info.gpuLayers`: Kev on CPU/WASM takes seconds per call.
 */
export async function loadDecisionModel(
  opts: Omit<LoadLlmOptions, "model" | "jinja"> & { modelUrl: string },
): Promise<DecisionClient> {
  const { wllama, info, log } = await loadWllama({ ...opts, jinja: false });
  return {
    systemOne: async (body) =>
      asSystemOneResponse(
        await withNativeLog(log, "decision model", () =>
          wllama.createSystemOne(body),
        ),
      ),
    info,
    exit: () => wllama.exit(),
  };
}

/** Remove every model wllama cached in this origin's OPFS. */
export async function clearModelCache(): Promise<void> {
  const { Wllama } = await importWllama();
  await new Wllama({ default: wllamaWasmUrl() }).cacheManager.clear();
}
