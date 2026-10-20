/**
 * Spike harness page. Every experiment writes into `window.__spikeResults`;
 * long runs are started with `spike.start(name)` and polled via `status`.
 */
import {
  loadLlm,
  probeWllama,
  type LlmBackend,
  type LlmClient,
} from "../../editors/knowledge-vault/chat/core/llm-client.js";

type Json = Record<string, unknown>;

interface SpikeResults {
  status: Record<string, string>;
  errors: Record<string, string>;
  logs: string[];
  [key: string]: unknown;
}

interface SpikeApi {
  start(name: string, ...args: unknown[]): string;
  run(name: string, ...args: unknown[]): Promise<unknown>;
  experiments: string[];
}

declare global {
  interface Window {
    __spikeResults: SpikeResults;
    spike: SpikeApi;
  }
}

const results: SpikeResults = { status: {}, errors: {}, logs: [] };
window.__spikeResults = results;

const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const progressEl = document.getElementById("progress");

function log(line: string) {
  results.logs.push(line);
  if (logEl) logEl.textContent = `${line}\n${logEl.textContent}`;
}

function setProgress(loaded: number, total: number) {
  if (progressEl instanceof HTMLProgressElement && total > 0) {
    progressEl.value = loaded / total;
  }
}

const clients: Partial<Record<LlmBackend, LlmClient>> = {};

function client(backend: LlmBackend): LlmClient {
  const c = clients[backend];
  if (!c) throw new Error(`load ${backend} first`);
  return c;
}

function backendArg(v: unknown): LlmBackend {
  return v === "cpu" ? "cpu" : "webgpu";
}

/* ------------------------------------------------------------------ */
/* Experiments                                                          */
/* ------------------------------------------------------------------ */

async function env(): Promise<Json> {
  const probe = await probeWllama();
  const hasGpu = "gpu" in navigator;
  let adapter: Json | null = null;
  if (hasGpu) {
    const a = await navigator.gpu.requestAdapter();
    if (a) {
      adapter = {
        vendor: a.info.vendor,
        architecture: a.info.architecture,
        device: a.info.device,
        description: a.info.description,
        shaderF16: a.features.has("shader-f16"),
        maxBufferSize: a.limits.maxBufferSize,
      };
    }
  }
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    crossOriginIsolated: window.crossOriginIsolated,
    navigatorGpu: hasGpu,
    adapter,
    ...probe,
  };
}

async function clearCache(): Promise<Json> {
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry("cache", { recursive: true });
    return { cleared: true };
  } catch (err) {
    return { cleared: false, reason: String(err) };
  }
}

async function cacheList(): Promise<Json> {
  const root = await navigator.storage.getDirectory();
  const out: { name: string; size: number }[] = [];
  try {
    const dir = await root.getDirectoryHandle("cache");
    for await (const [name, handle] of dirEntries(dir)) {
      if (handle instanceof FileSystemFileHandle) {
        out.push({ name, size: (await handle.getFile()).size });
      }
    }
  } catch {
    // no cache dir yet
  }
  return { files: out };
}

function dirEntries(
  dir: FileSystemDirectoryHandle,
): AsyncIterable<[string, FileSystemHandle]> {
  return (
    dir as FileSystemDirectoryHandle & {
      entries(): AsyncIterable<[string, FileSystemHandle]>;
    }
  ).entries();
}

async function load(backendRaw: unknown, jinjaRaw: unknown): Promise<Json> {
  const backend = backendArg(backendRaw);
  await clients[backend]?.exit();
  delete clients[backend];
  const nativeLog: string[] = [];
  try {
    const c = await loadLlm({
      backend,
      jinja: jinjaRaw === true,
      onProgress: setProgress,
      onLog: (level, line) => {
        if (level !== "debug") nativeLog.push(`[${level}] ${line}`);
      },
    });
    clients[backend] = c;
    return { ...c.info, nativeLogTail: nativeLog.slice(-15) };
  } catch (err) {
    results.errors[`load-${backend}-native`] = nativeLog.slice(-40).join("\n");
    throw err;
  }
}

async function stream(backendRaw: unknown): Promise<Json> {
  const backend = backendArg(backendRaw);
  const c = client(backend);
  let out = "";
  const r = await c.chatStream(
    [
      {
        role: "user",
        content:
          "Write a long, detailed essay about the history of public libraries.",
      },
    ],
    {
      maxTokens: 128,
      temperature: 0.7,
      seed: 42,
      onDelta: (d) => {
        out += d;
        if (statusEl) statusEl.textContent = `${out.length} chars`;
      },
    },
  );
  let timings = r.timings;
  let timingsSource = "last chunk";
  if (!r.timingsOnLastChunk) {
    const r2 = await c.chatStream(
      [{ role: "user", content: "Write a long essay about libraries." }],
      { maxTokens: 128, temperature: 0.7, seed: 42, timingsPerToken: true },
    );
    timings = r2.timings;
    timingsSource = r2.timingsOnLastChunk
      ? "last chunk (timings_per_token)"
      : "last chunk carrying timings (timings_per_token)";
  }
  return {
    backend,
    text: r.text,
    chunks: r.chunks,
    finishReason: r.finishReason,
    wallMs: r.wallMs,
    timingsOnLastChunk: r.timingsOnLastChunk,
    timingsSource,
    timings,
  };
}

async function barrels(): Promise<Json> {
  const t0 = performance.now();
  const { buildVaultCatalog } =
    await import("../../editors/knowledge-vault/chat/core/catalog-models.js");
  const catalog = buildVaultCatalog();
  return {
    ok: true,
    entries: catalog.length,
    importMs: performance.now() - t0,
  };
}

async function unload(backendRaw: unknown): Promise<Json> {
  const backend = backendArg(backendRaw);
  await clients[backend]?.exit();
  delete clients[backend];
  return { unloaded: backend };
}

const EXPERIMENTS: Record<string, (...args: unknown[]) => Promise<unknown>> = {
  env,
  clearCache,
  cacheList,
  load,
  stream,
  barrels,
  unload,
};

/* ------------------------------------------------------------------ */
/* Runner                                                               */
/* ------------------------------------------------------------------ */

async function run(name: string, ...args: unknown[]): Promise<unknown> {
  const fn = EXPERIMENTS[name];
  if (!(name in EXPERIMENTS)) throw new Error(`unknown experiment ${name}`);
  const label = [name, ...args.map((a) => JSON.stringify(a))].join(":");
  results.status[label] = "running";
  if (statusEl) statusEl.textContent = `${label} running`;
  log(`> ${label}`);
  try {
    const value = await fn(...args);
    results[label] = value;
    results.status[label] = "done";
    log(`< ${label} ${JSON.stringify(value).slice(0, 600)}`);
    return value;
  } catch (err) {
    const msg =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    results.errors[label] = msg;
    results.status[label] = "error";
    log(`! ${label} ${msg}`);
    throw err;
  } finally {
    if (statusEl) statusEl.textContent = `${label} ${results.status[label]}`;
  }
}

window.spike = {
  experiments: Object.keys(EXPERIMENTS),
  run,
  start(name, ...args) {
    run(name, ...args).catch(() => undefined);
    return "started";
  },
};

const buttons: [string, unknown[]][] = [
  ["env", []],
  ["barrels", []],
  ["clearCache", []],
  ["cacheList", []],
  ["load", ["webgpu"]],
  ["stream", ["webgpu"]],
  ["unload", ["webgpu"]],
  ["load", ["cpu"]],
  ["stream", ["cpu"]],
  ["unload", ["cpu"]],
];
const buttonsEl = document.getElementById("buttons");
for (const [name, args] of buttons) {
  const b = document.createElement("button");
  b.textContent = [name, ...args.map(String)].join(" ");
  b.onclick = () => window.spike.start(name, ...args);
  buttonsEl?.append(b);
}
const copy = document.createElement("button");
copy.textContent = "Copy JSON";
copy.onclick = () => {
  void navigator.clipboard.writeText(JSON.stringify(results, null, 2));
};
buttonsEl?.append(copy);
log("harness ready");
