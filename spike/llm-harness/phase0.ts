/**
 * Connect plan phase 0 (go/no-go): configuration C's two models in wllama
 * 3.8.1 in the browser. Kev-FT System One option probabilities and the X5
 * token-id / mixed-prompt trie, compared with native llama-server outputs.
 *
 * Fixtures come from the spike's native generator, served at `/c-spike/`
 * (vite PHASE0_FIXTURES); GGUFs at `/x5/` and `/kevft/`. Driven from devtools:
 *   window.__phase0.start("env") … then poll window.__phase0.state
 */
import { importWllama } from "../../editors/knowledge-vault/chat/core/llm-client.js";

const X5_URL = "/x5/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf";
const KEV_URL = "/kevft/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf";
const KEV_SERVED_T = 2.700699806213379;
const WASM = new URL("../../vendor/wllama/3.8.1/wllama.wasm", import.meta.url)
  .href;

type Json = unknown;
// wllama's own types are not vendored; the spike reads raw responses.
/* eslint-disable @typescript-eslint/no-explicit-any */
type W = any;

interface TrieFx {
  id: string;
  keys: string[];
  templated: string;
  promptIds: number[];
  answers: { key: string; ids: number[]; pieces: string[] }[];
  nativeRoot: [number, number][];
  nativeDeep: { path: number[]; top: [number, number][] };
  stored: {
    loraPick: string;
    loraExact: Record<string, number>;
    loraBranch: Record<string, number>;
    exactMs: number;
    exactRequests: number;
  };
}
interface KevFx {
  id: string;
  names: string[];
  candidates: string[];
  body: Json;
  storedProbs: number[];
  storedLogprobsT1: number[];
  servedT: number;
  storedMs: number;
}

const state: {
  busy: string | null;
  done: string[];
  error: string | null;
  results: Record<string, Json>;
  native: Record<string, string[]>;
} = { busy: null, done: [], error: null, results: {}, native: {} };
const inst: Record<string, W> = {};
let fx: { trie: TrieFx[]; kev: KevFx[] } | null = null;

const INTERESTING =
  /webgpu|ggml_|offload|gated_delta|ssm_|unsupported|fallback|error|warn|device|buffer|layers|n_ctx|kv|compute|model size|type +q|graph|fail|abort|limit/i;

function logger(role: string) {
  const lines = (state.native[role] ??= []);
  const push = (lvl: string, a: unknown[]) => {
    const line = `${lvl} ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}`;
    if (lines.length < 400 || INTERESTING.test(line)) lines.push(line.slice(0, 400));
  };
  return {
    debug: (...a: unknown[]) => push("debug", a),
    log: (...a: unknown[]) => push("log", a),
    warn: (...a: unknown[]) => push("warn", a),
    error: (...a: unknown[]) => push("error", a),
  };
}

async function memory(): Promise<Json> {
  const pm = (performance as any).memory;
  const out: Record<string, Json> = {
    jsHeapUsedMB: pm ? Math.round(pm.usedJSHeapSize / 1e6) : null,
    jsHeapLimitMB: pm ? Math.round(pm.jsHeapSizeLimit / 1e6) : null,
  };
  const m = (performance as any).measureUserAgentSpecificMemory;
  if (crossOriginIsolated && typeof m === "function") {
    try {
      const r = await m.call(performance);
      out.uasmTotalMB = Math.round(r.bytes / 1e6);
      const byType: Record<string, number> = {};
      for (const b of r.breakdown) {
        const k = `${b.types.join("+") || "none"}@${b.attribution.map((a: any) => a.scope).join("+") || "-"}`;
        byType[k] = (byType[k] ?? 0) + Math.round(b.bytes / 1e6);
      }
      out.uasmBreakdownMB = byType;
    } catch (e) {
      out.uasmError = String(e);
    }
  } else out.uasm = "unavailable (not crossOriginIsolated)";
  return out;
}

async function env(): Promise<Json> {
  const out: Record<string, Json> = {
    ua: navigator.userAgent,
    crossOriginIsolated,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as any).deviceMemory,
  };
  const { Wllama } = await importWllama();
  out.libllama = (Wllama as any).getLibllamaVersion();
  const gpu = (navigator as any).gpu;
  if (gpu) {
    const a = await gpu.requestAdapter();
    if (a) {
      out.adapter = { ...a.info.toJSON?.() } as Json;
      if (!out.adapter || Object.keys(out.adapter as object).length === 0)
        out.adapter = {
          vendor: a.info.vendor,
          architecture: a.info.architecture,
          device: a.info.device,
          description: a.info.description,
        };
      out.limits = {
        maxBufferSize: a.limits.maxBufferSize,
        maxStorageBufferBindingSize: a.limits.maxStorageBufferBindingSize,
        maxComputeWorkgroupStorageSize: a.limits.maxComputeWorkgroupStorageSize,
      };
      out.features = [...a.features].sort();
    }
  }
  out.memory = await memory();
  return out;
}

async function loadFx(): Promise<Json> {
  const [trie, kev] = await Promise.all([
    fetch("/c-spike/trie.json").then((r) => r.json()),
    fetch("/c-spike/kev.json").then((r) => r.json()),
  ]);
  fx = { trie: trie.trie, kev };
  const heads = await Promise.all(
    [X5_URL, KEV_URL].map(async (u) => {
      const r = await fetch(u, { method: "HEAD" });
      return [u, r.status, r.headers.get("content-length")];
    }),
  );
  return { trie: fx.trie.map((t) => t.id), kev: fx.kev.map((k) => k.id), heads };
}

async function load(
  role: "x5" | "kev",
  ngl: number,
  extra: Record<string, unknown> = {},
): Promise<Json> {
  const { Wllama } = await importWllama();
  if (inst[role]) await inst[role].exit();
  const w: W = new (Wllama as any)({ default: WASM }, { logger: logger(role) });
  let bytes = 0;
  let firstProgressMs: number | null = null;
  let downloadedMs: number | null = null;
  const t0 = performance.now();
  const params = {
    n_ctx: role === "kev" ? 8192 : 4096,
    n_parallel: 1,
    n_gpu_layers: ngl,
    jinja: false,
    useCache: false,
    ...extra,
    progressCallback: ({ loaded, total }: { loaded: number; total: number }) => {
      bytes = total;
      firstProgressMs ??= performance.now() - t0;
      if (loaded >= total) downloadedMs ??= performance.now() - t0;
    },
  };
  await w.loadModelFromUrl(role === "kev" ? KEV_URL : X5_URL, params);
  const loadMs = performance.now() - t0;
  inst[role] = w;
  const meta = w.getModelMetadata();
  const ctx = w.getLoadedContextInfo();
  const pick = (re: RegExp) =>
    Object.fromEntries(
      Object.entries(meta.meta as Record<string, string>).filter(([k]) =>
        re.test(k),
      ),
    );
  const out: Record<string, Json> = {
    ngl,
    extra,
    n_batch: ctx.n_batch,
    n_ubatch: ctx.n_ubatch,
    loadMs: Math.round(loadMs),
    downloadedMs: downloadedMs && Math.round(downloadedMs),
    bytes,
    webgpuSupported: w.isSupportWebGPU(),
    multithread: w.isMultithread(),
    threads: w.getNumThreads(),
    hparams: meta.hparams,
    meta: pick(
      /general\.(name|architecture)|decision|tokenizer\.ggml\.(pre|model)|file_type|block_count|context_length/,
    ),
    ctx: {
      token_bos: ctx.token_bos,
      token_eos: ctx.token_eos,
      token_eot: ctx.token_eot,
      add_bos_token: ctx.add_bos_token,
      list_tokens_eog: ctx.list_tokens_eog,
      keys: Object.keys(ctx).filter((k) => !k.startsWith("metadata")),
    },
    memory: await memory(),
  };
  if (role === "kev") {
    const t = Number(
      (meta.meta as Record<string, string>)["qwen35.decision.temperature.choice"],
    );
    out.servedT = t;
    out.servedTOk = Math.abs(t - KEV_SERVED_T) < 1e-6;
  }
  return out;
}

const argmax = (xs: number[]) => xs.reduce((b, x, i) => (x > xs[b] ? i : b), 0);
const logT1 = (probs: number[], T: number) => {
  const z = probs.map((p) => T * Math.log(Math.max(p, 1e-300)));
  const m = Math.max(...z);
  const lse = m + Math.log(z.reduce((s, x) => s + Math.exp(x - m), 0));
  return z.map((x) => x - lse);
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};

async function kevCheck(reps = 5): Promise<Json> {
  const kev = inst.kev;
  if (!kev || !fx) throw new Error("load fx + kev first");
  const tw = performance.now();
  const raw0 = await kev.createSystemOne(fx.kev[0].body); // warm-up
  const warmMs = performance.now() - tw;
  const items = [];
  for (const k of fx.kev) {
    const ts: number[] = [];
    let res: any;
    for (let i = 0; i < reps; i++) {
      const t0 = performance.now();
      res = await kev.createSystemOne(k.body);
      ts.push(performance.now() - t0);
    }
    const pr = res.answers.q0.probabilities as Record<string, number>;
    const probs = k.names.map((n) => pr[n]);
    const dp = probs.map((p, i) => Math.abs(p - k.storedProbs[i]));
    const lt = logT1(probs, KEV_SERVED_T);
    const dl = lt.map((x, i) => Math.abs(x - k.storedLogprobsT1[i]));
    const iMax = argmax(dp);
    items.push({
      id: k.id,
      nOpts: k.names.length,
      missing: k.names.filter((n) => !(n in pr)),
      pickSame: argmax(probs) === argmax(k.storedProbs),
      maxDp: dp[iMax],
      maxDpAt: { name: k.names[iMax], browser: probs[iMax], native: k.storedProbs[iMax] },
      maxDlogprobT1: Math.max(...dl),
      topBrowser: [k.names[argmax(probs)], probs[argmax(probs)]],
      topNative: [k.names[argmax(k.storedProbs)], k.storedProbs[argmax(k.storedProbs)]],
      usage: res.usage,
      msMedian: Math.round(median(ts)),
      ms: ts.map(Math.round),
      nativeMs: k.storedMs,
    });
  }
  return {
    responseShape: JSON.stringify(raw0).slice(0, 1500),
    warmMs: Math.round(warmMs),
    maxDpAll: Math.max(...items.map((i) => i.maxDp)),
    picksSame: items.filter((i) => i.pickSame).length,
    items,
    memory: await memory(),
  };
}

/** One-token completion: id -> logprob from whatever shape wllama returns. */
async function nextDist(
  prompt: string,
  nProbs: number,
  keepRaw = false,
): Promise<{ lp: Map<number, number>; minLp: number; raw?: Json; ms: number }> {
  const t0 = performance.now();
  const res: any = await inst.x5.createCompletion({
    prompt,
    n_predict: 1,
    temperature: 0,
    n_probs: nProbs,
    cache_prompt: true,
    stream: false,
  });
  const ms = performance.now() - t0;
  let tops: { id: number; logprob: number }[] =
    res?.completion_probabilities?.[0]?.top_logprobs ??
    res?.choices?.[0]?.logprobs?.content?.[0]?.top_logprobs ??
    [];
  if (!tops.length && Array.isArray(res?.probs)) tops = res.probs[0]?.top_logprobs ?? [];
  const lp = new Map<number, number>();
  let minLp = 0;
  for (const t of tops) {
    lp.set(t.id, t.logprob);
    minLp = Math.min(minLp, t.logprob);
  }
  return { lp, minLp, ms, raw: keepRaw ? res : undefined };
}

/**
 * Unconstrained logprob of one given next token: logit_bias forces it to be
 * sampled, and llama-server reports the sampled token's probability from the
 * raw (pre-sampler) softmax. Replaces lib.ts's n_probs 8192 retry, which
 * wllama cannot serialise (partial-UTF-8 byte tokens: json type_error.316).
 */
async function forcedLp(prompt: string, id: number): Promise<{ lp: number; gotId: number; ms: number }> {
  const t0 = performance.now();
  const res: any = await inst.x5.createCompletion({
    prompt,
    n_predict: 1,
    temperature: 0,
    n_probs: 1,
    logit_bias: [[id, 100]],
    cache_prompt: true,
    stream: false,
  });
  const c = res?.choices?.[0]?.logprobs?.content?.[0];
  return { lp: c?.logprob, gotId: c?.id, ms: performance.now() - t0 };
}

function cmpDist(lp: Map<number, number>, native: [number, number][]) {
  let maxD = 0;
  let missing = 0;
  for (const [id, v] of native) {
    const b = lp.get(id);
    if (b === undefined) missing++;
    else maxD = Math.max(maxD, Math.abs(b - v));
  }
  const bTop = [...lp.entries()].sort((a, b) => b[1] - a[1])[0];
  return { maxD, missing, n: lp.size, top1Same: bTop?.[0] === native[0][0] };
}

async function mixedCheck(): Promise<Json> {
  if (!inst.x5 || !fx) throw new Error("load fx + x5 first");
  const out = [];
  let rawShape: Json = null;
  const idsTry: Record<string, string> = {};
  for (const p of [fx.trie[0].promptIds, [fx.trie[0].templated, 38685]]) {
    try {
      await inst.x5.createCompletion({ prompt: p, n_predict: 1, n_probs: 2, stream: false });
      idsTry[typeof p[1]] = "ok";
    } catch (e) {
      idsTry[typeof p[1]] = String(e);
    }
  }
  for (const t of fx.trie) {
    const mixed = await nextDist(t.templated, 64, rawShape === null);
    if (rawShape === null)
      rawShape = JSON.stringify(mixed.raw, (_k, v) =>
        Array.isArray(v) && v.length > 3 ? [...v.slice(0, 3), `…${v.length}`] : v,
      ).slice(0, 2000);
    const deep = await nextDist(t.templated + t.answers[0].pieces[0], 64);
    const probe = [...mixed.lp.entries()].sort((a, b) => b[1] - a[1]).filter((_, i) => i === 0 || i === 5 || i === 40);
    const forcedVsTop = [];
    for (const [id, v] of probe) {
      const f = await forcedLp(t.templated, id);
      forcedVsTop.push({ id, top64: v, forced: f.lp, gotId: f.gotId, ms: Math.round(f.ms) });
    }
    out.push({
      id: t.id,
      promptTokens: t.promptIds.length,
      stringRootVsNativeIds: cmpDist(mixed.lp, t.nativeRoot),
      stringDeepVsNativeIds: cmpDist(deep.lp, t.nativeDeep.top),
      ms: [mixed.ms, deep.ms].map(Math.round),
      forcedVsTop,
    });
  }
  return { idPromptsTried: idsTry, rawShape, items: out };
}

/** Line-for-line port of rig lib.ts trieScore over the wllama nextDist. */
async function trieScore(
  prompt: string,
  answers: { key: string; ids: number[]; pieces: string[] }[],
  mode: "exact" | "branch",
  nProbs = 64,
) {
  const t0 = performance.now();
  const kids = new Map<string, Set<number>>();
  // String prompts only (wllama rejects token arrays): a path's text is the
  // concatenated pieces; natively verified to retokenise to the same ids.
  const text = new Map<string, string>();
  for (const a of answers)
    for (let i = 0; i < a.ids.length; i++) {
      const k = a.ids.slice(0, i).join(",");
      text.set(k, a.pieces.slice(0, i).join(""));
      if (!kids.has(k)) kids.set(k, new Set());
      kids.get(k)!.add(a.ids[i]);
    }
  const order: number[][] = [];
  const visit = (path: number[]) => {
    const ch = kids.get(path.join(","));
    if (!ch) return;
    if (mode === "exact" || ch.size >= 2) order.push(path);
    for (const c of ch) visit([...path, c]);
  };
  visit([]);
  const dist = new Map<string, { lp: Map<number, number>; minLp: number }>();
  let requests = 0;
  let floored = 0;
  let forced = 0;
  let dumpErrors = 0;
  const reqMs: number[] = [];
  for (const path of order) {
    const need = kids.get(path.join(","))!;
    const ptext = prompt + text.get(path.join(","))!;
    let d: { lp: Map<number, number>; minLp: number; ms: number };
    try {
      d = await nextDist(ptext, nProbs);
    } catch {
      dumpErrors++;
      d = { lp: new Map(), minLp: 0, ms: 0 };
    }
    requests++;
    reqMs.push(d.ms);
    for (const c of need)
      if (!d.lp.has(c)) {
        const f = await forcedLp(ptext, c);
        requests++;
        forced++;
        if (f.gotId !== c || typeof f.lp !== "number") throw new Error(`forced ${c} got ${f.gotId}`);
        d.lp.set(c, f.lp);
        d.minLp = Math.min(d.minLp, f.lp);
      }
    dist.set(path.join(","), d);
  }
  const sums: Record<string, number> = {};
  for (const a of answers) {
    const lps: number[] = [];
    for (let i = 0; i < a.ids.length; i++) {
      const d = dist.get(a.ids.slice(0, i).join(","));
      if (!d) continue;
      let v = d.lp.get(a.ids[i]);
      if (v === undefined) {
        floored++;
        v = d.minLp;
      }
      lps.push(v);
    }
    sums[a.key] = lps.reduce((x, y) => x + y, 0);
  }
  return { sums, requests, floored, forced, dumpErrors, ms: performance.now() - t0, reqMs };
}

async function trieCheck(): Promise<Json> {
  if (!inst.x5 || !fx) throw new Error("load fx + x5 first");
  const items = [];
  for (const t of fx.trie) {
    const prompt = t.templated;
    const row: Record<string, Json> = { id: t.id, nAnswers: t.answers.length };
    for (const mode of ["branch", "exact"] as const) {
      const r = await trieScore(prompt, t.answers, mode);
      const stored = mode === "exact" ? t.stored.loraExact : t.stored.loraBranch;
      const d = t.answers.map((a) => Math.abs(r.sums[a.key] - stored[a.key]));
      const top = (s: Record<string, number>) =>
        Object.entries(s).sort((a, b) => b[1] - a[1])[0][0];
      row[mode] = {
        requests: r.requests,
        floored: r.floored,
        forced: r.forced,
        dumpErrors: r.dumpErrors,
        ms: Math.round(r.ms),
        reqMsMedian: Math.round(median(r.reqMs)),
        maxD: Math.max(...d),
        medianD: median(d),
        argmaxSame: top(r.sums) === top(stored),
        sums: r.sums,
      };
    }
    row.nativeExactMs = t.stored.exactMs;
    row.nativeExactRequests = t.stored.exactRequests;
    items.push(row);
  }
  return { items, memory: await memory() };
}

async function unload(role: string): Promise<Json> {
  if (inst[role]) await inst[role].exit();
  delete inst[role];
  return { unloaded: role, memory: await memory() };
}

const steps: Record<string, (...a: any[]) => Promise<Json>> = {
  env,
  loadFx,
  load: (role: "x5" | "kev", ngl = 99999, extra = {}) => load(role, ngl, extra),
  kevCheck,
  mixedCheck,
  trieCheck,
  unload,
  memory,
};

function start(name: string, ...args: unknown[]): string {
  if (state.busy) return `busy: ${state.busy}`;
  const label = [name, ...args.map(String)].join(" ");
  state.busy = label;
  state.error = null;
  void steps[name](...args)
    .then((r) => {
      state.results[label] = r;
      state.done.push(label);
    })
    .catch((e: unknown) => {
      state.error = `${label}: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`;
    })
    .finally(() => {
      state.busy = null;
    });
  return `started ${label}`;
}

declare global {
  interface Window {
    __phase0: { start: typeof start; state: typeof state; inst: typeof inst };
  }
}
window.__phase0 = { start, state, inst };
