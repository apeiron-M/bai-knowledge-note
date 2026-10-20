import type {
  WllamaChatMessage,
  WllamaChatParams,
  WllamaInstance,
  WllamaModule,
  WllamaResponseFormat,
  WllamaTimings,
} from "./wllama-types.js";

export const WLLAMA_VERSION = "3.8.1";
export const WLLAMA_ESM_URL = `https://cdn.jsdelivr.net/npm/@wllama/wllama@${WLLAMA_VERSION}/esm/index.js`;
export const WLLAMA_WASM_URL = `https://cdn.jsdelivr.net/npm/@wllama/wllama@${WLLAMA_VERSION}/esm/wasm/wllama.wasm`;
export const DEFAULT_MODEL = {
  repo: "LiquidAI/LFM2.5-350M-GGUF",
  file: "LFM2.5-350M-Q4_K_M.gguf",
};

export type LlmBackend = "webgpu" | "cpu";

export interface LoadLlmOptions {
  backend: LlmBackend;
  onProgress?: (loaded: number, total: number) => void;
  /** Use the GGUF's jinja chat template via llama.cpp's minja. */
  jinja?: boolean;
  nCtx?: number;
  model?: { repo: string; file: string };
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
}

export interface LlmClient {
  chatStream(
    messages: WllamaChatMessage[],
    opts?: ChatOptions,
  ): Promise<ChatResult>;
  completeJson: CompleteJson;
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

const INLINE_EXPORTS_KEY = "__wllamaInlineExports";

/**
 * Connect's CSP (`script-src 'self' 'unsafe-inline' 'unsafe-eval' <registry>`,
 * no `connect-src`) lets us fetch the CDN bundle but not import it. The wllama
 * ESM is one self-contained file whose only export statement is the trailing
 * `export { ... }`; rewrite that into a callback and run it inline.
 *
 * TODO(spike): bundle `@wllama/wllama` as a dependency so it is served from
 * `'self'` instead.
 */
async function importWllamaInline(): Promise<unknown> {
  const res = await fetch(WLLAMA_ESM_URL);
  if (!res.ok) throw new Error(`wllama ESM fetch failed: HTTP ${res.status}`);
  const src = await res.text();
  const match = /\nexport\s*\{([^}]*)\};?\s*$/.exec(src);
  if (!match) throw new Error("wllama ESM: trailing export block not found");
  const fields = match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [local, exported] = entry.split(/\s+as\s+/);
      return exported ? `${JSON.stringify(exported)}: ${local}` : local;
    })
    .join(", ");
  const script = document.createElement("script");
  script.type = "module";
  script.textContent = `${src.slice(0, match.index)}\nglobalThis[${JSON.stringify(INLINE_EXPORTS_KEY)}]({ ${fields} });\n`;

  return new Promise<unknown>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("error", onError);
      Reflect.deleteProperty(globalThis, INLINE_EXPORTS_KEY);
      script.remove();
    };
    const onError = (e: ErrorEvent) => {
      cleanup();
      reject(e.error instanceof Error ? e.error : new Error(e.message));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("wllama inline module did not run (CSP?)"));
    }, 30_000);
    Reflect.set(globalThis, INLINE_EXPORTS_KEY, (exports: unknown) => {
      cleanup();
      resolve(exports);
    });
    window.addEventListener("error", onError);
    document.head.appendChild(script);
  });
}

/**
 * Dynamically import the wllama ESM from the CDN (cached per page). Falls back
 * to an inline module script when the page's CSP blocks the import.
 */
export function importWllama(): Promise<WllamaModule> {
  modulePromise ??= (async () => {
    let mod: unknown;
    try {
      mod = await import(/* @vite-ignore */ WLLAMA_ESM_URL);
    } catch (err) {
      if (typeof document === "undefined") throw err;
      mod = await importWllamaInline();
    }
    if (!isWllamaModule(mod))
      throw new Error("wllama ESM has no Wllama export");
    return mod;
  })().catch((err: unknown) => {
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
  const probe = new Wllama({ default: WLLAMA_WASM_URL });
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

export async function loadLlm(opts: LoadLlmOptions): Promise<LlmClient> {
  const { Wllama } = await importWllama();
  const model = opts.model ?? DEFAULT_MODEL;
  const nCtx = opts.nCtx ?? 4096;
  const log = opts.onLog;
  const wllama = new Wllama(
    { default: WLLAMA_WASM_URL },
    log
      ? {
          logger: {
            debug: (...a: unknown[]) => log("debug", a.map(String).join(" ")),
            log: (...a: unknown[]) => log("log", a.map(String).join(" ")),
            warn: (...a: unknown[]) => log("warn", a.map(String).join(" ")),
            error: (...a: unknown[]) => log("error", a.map(String).join(" ")),
          },
        }
      : { suppressNativeLog: true },
  );
  let downloadBytes = 0;
  const t0 = performance.now();
  await wllama.loadModelFromHF(model, {
    n_ctx: nCtx,
    n_parallel: 1,
    n_gpu_layers: opts.backend === "webgpu" ? 99999 : 0,
    jinja: opts.jinja,
    progressCallback: ({ loaded, total }) => {
      downloadBytes = total;
      opts.onProgress?.(loaded, total);
    },
  });
  const loadMs = performance.now() - t0;
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
    jinja: opts.jinja ?? false,
    model,
    hasChatTemplate: wllama.getChatTemplate() !== null,
  };

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

  return {
    chatStream: (messages, o = {}) => runChat(wllama, messages, o),
    completeJson,
    info,
    exit: () => wllama.exit(),
  };
}
