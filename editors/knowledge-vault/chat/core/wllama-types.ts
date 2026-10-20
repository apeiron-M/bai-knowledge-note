/**
 * Hand-written subset of the @wllama/wllama@3.8.1 API. wllama is loaded
 * from jsdelivr at runtime (its npm `main` is broken), so these types stand
 * in for its own .d.ts.
 */

export interface WllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface WllamaTimings {
  cache_n?: number;
  prompt_n: number;
  prompt_ms: number;
  prompt_per_second: number;
  predicted_n: number;
  predicted_ms: number;
  predicted_per_second: number;
}

export interface WllamaChunk {
  choices: {
    delta: { content?: string | null };
    finish_reason: string | null;
  }[];
  timings?: WllamaTimings;
}

export interface WllamaProgress {
  loaded: number;
  total: number;
}

export interface WllamaLoadParams {
  n_ctx?: number;
  n_parallel?: number;
  n_gpu_layers?: number;
  n_threads?: number;
  seed?: number;
  jinja?: boolean;
  useCache?: boolean;
  progressCallback?: (p: WllamaProgress) => void;
}

export interface WllamaResponseFormat {
  type: "text" | "json_object" | "json_schema";
  json_schema?: { name: string; schema: unknown; strict?: boolean };
}

export interface WllamaChatParams {
  messages: WllamaChatMessage[];
  stream: true;
  max_tokens?: number;
  temperature?: number;
  seed?: number;
  response_format?: WllamaResponseFormat;
  grammar?: string;
  timings_per_token?: boolean;
  abortSignal?: AbortSignal;
}

export interface WllamaCacheManager {
  clear(): Promise<void>;
  list(): Promise<{ name: string; size: number }[]>;
}

export interface WllamaInstance {
  cacheManager: WllamaCacheManager;
  loadModelFromHF(
    hf: { repo: string; file?: string },
    params?: WllamaLoadParams,
  ): Promise<void>;
  createChatCompletion(
    params: WllamaChatParams,
  ): Promise<AsyncIterable<WllamaChunk>>;
  isSupportWebGPU(): boolean;
  isMultithread(): boolean;
  getNumThreads(): number;
  getChatTemplate(): string | null;
  exit(): Promise<void>;
}

export interface WllamaLogger {
  debug: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface WllamaConstructor {
  new (
    paths: { default: string },
    config?: { suppressNativeLog?: boolean; logger?: WllamaLogger },
  ): WllamaInstance;
  getLibllamaVersion(): string;
}

export interface WllamaModule {
  Wllama: WllamaConstructor;
}
