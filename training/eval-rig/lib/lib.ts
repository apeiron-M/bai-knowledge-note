/**
 * X3: native llama-server client (same llama.cpp commit 46ca246 that wllama
 * 3.8.1 embeds, --no-jinja) implementing the chat core's CompleteJson /
 * ScoreText, plus token-trie scoring of the step-1 answers with token-id
 * prompts on /completion.
 */
import type {
  CompleteJson,
  ScoreText,
} from "../../../editors/knowledge-vault/chat/core/llm-client.js";
import type { WllamaChatMessage } from "../../../editors/knowledge-vault/chat/core/wllama-types.js";

export const BASE = process.env.LLAMA_URL ?? "http://127.0.0.1:18733";
export const IM_END = 7;
export const BOS = 1;

export class RateLimited extends Error {}

export async function post(route: string, body: unknown): Promise<any> {
  const res = await fetch(BASE + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new RateLimited(`429 on ${route}`);
  if (!res.ok) throw new Error(`${route}: ${res.status} ${await res.text()}`);
  return res.json();
}

export const completeJson: CompleteJson = async (messages, constraint, o = {}) => {
  const t0 = performance.now();
  const body: Record<string, unknown> = {
    messages,
    stream: false,
    max_tokens: o.maxTokens ?? 256,
    temperature: o.temperature ?? 0,
    seed: o.seed,
  };
  if (constraint.kind === "json_schema")
    body.response_format = {
      type: "json_schema",
      json_schema: { name: constraint.name, schema: constraint.schema, strict: true },
    };
  else body.grammar = constraint.grammar;
  const res = await post("/v1/chat/completions", body);
  const choice = res.choices?.[0];
  const text: string = choice?.message?.content ?? "";
  const base = {
    text,
    chunks: 1,
    finishReason: choice?.finish_reason ?? null,
    timings: res.timings,
    timingsOnLastChunk: true,
    wallMs: performance.now() - t0,
  };
  try {
    return { ...base, parsed: JSON.parse(text) as unknown };
  } catch (err) {
    return { ...base, parsed: undefined, parseError: String(err) };
  }
};

export const scoreText: ScoreText = async (messages, grammar, o = {}) => {
  const t0 = performance.now();
  const res = await post("/v1/chat/completions", {
    messages,
    stream: false,
    max_tokens: o.maxTokens ?? 48,
    temperature: 0,
    grammar: grammar || undefined,
    logprobs: true,
    top_logprobs: o.topLogprobs ?? 1,
  });
  const choice = res.choices?.[0];
  return {
    text: choice?.message?.content ?? "",
    tokens: choice?.logprobs?.content ?? [],
    finishReason: choice?.finish_reason ?? null,
    timings: res.timings,
    wallMs: performance.now() - t0,
  };
};

/** Step-1 generation with per-token logprobs (top_logprobs) of the greedy path. */
export async function generateWithLogprobs(
  messages: WllamaChatMessage[],
  grammar: string,
  topLogprobs: number,
) {
  const t0 = performance.now();
  const res = await post("/v1/chat/completions", {
    messages,
    stream: false,
    max_tokens: 64,
    temperature: 0,
    grammar,
    logprobs: true,
    top_logprobs: topLogprobs,
  });
  const choice = res.choices?.[0];
  return {
    text: (choice?.message?.content ?? "") as string,
    tokens: (choice?.logprobs?.content ?? []) as {
      token: string;
      logprob: number;
      top_logprobs: { token: string; logprob: number }[];
    }[],
    wallMs: performance.now() - t0,
    timings: res.timings,
  };
}

export async function promptIds(messages: WllamaChatMessage[]): Promise<number[]> {
  const { prompt } = await post("/apply-template", { messages });
  const { tokens } = await post("/tokenize", {
    content: prompt,
    add_special: false,
    parse_special: true,
  });
  return [BOS, ...(tokens as number[])];
}

const answerIdCache = new Map<string, { ids: number[]; pieces: string[] }>();

/** Canonical token ids (and pieces) of an answer text, plus <|im_end|>. */
export async function answerIds(text: string): Promise<{ ids: number[]; pieces: string[] }> {
  const hit = answerIdCache.get(text);
  if (hit) return hit;
  const { tokens } = await post("/tokenize", {
    content: text,
    add_special: false,
    parse_special: false,
    with_pieces: true,
  });
  const v = {
    ids: [...(tokens as { id: number }[]).map((t) => t.id), IM_END],
    pieces: [...(tokens as { piece: string }[]).map((t) => t.piece), ""],
  };
  answerIdCache.set(text, v);
  return v;
}

interface NodeDist {
  /** token id -> logprob (top-N of the full-vocab softmax). */
  lp: Map<number, number>;
  minLp: number;
}

/** One /completion step: the next-token distribution after `ids`. */
async function nextDist(ids: number[], nProbs: number): Promise<NodeDist> {
  const res = await post("/completion", {
    prompt: ids,
    n_predict: 1,
    temperature: 0,
    n_probs: nProbs,
    cache_prompt: true,
    return_tokens: false,
  });
  const cp = res.completion_probabilities?.[0];
  const lp = new Map<number, number>();
  let minLp = 0;
  for (const t of cp?.top_logprobs ?? []) {
    lp.set(t.id, t.logprob);
    minLp = Math.min(minLp, t.logprob);
  }
  return { lp, minLp };
}

export interface TrieResult {
  /** key -> per-token logprobs (exact mode: every token; branch mode: branch tokens only). */
  logprobs: Record<string, number[]>;
  nTokens: Record<string, number>;
  requests: number;
  ms: number;
  /** Children missing from top-N even after the wide retry (logprob floored). */
  floored: number;
}

/**
 * Trie scoring of answers under one prompt. `mode: "exact"` queries every
 * internal node (DFS, so consecutive prompts share the KV prefix);
 * `mode: "branch"` queries only nodes with >= 2 children and treats the
 * single-child tokens as logprob 0 (the decision-models note's ≤ 8-request
 * proposal).
 */
export async function trieScore(
  prompt: number[],
  answers: { key: string; ids: number[] }[],
  mode: "exact" | "branch",
  nProbs = 64,
): Promise<TrieResult> {
  const t0 = performance.now();
  // children of each prefix (keyed by joined ids)
  const kids = new Map<string, Set<number>>();
  for (const a of answers)
    for (let i = 0; i < a.ids.length; i++) {
      const k = a.ids.slice(0, i).join(",");
      if (!kids.has(k)) kids.set(k, new Set());
      kids.get(k)!.add(a.ids[i]);
    }
  // DFS order of internal nodes
  const order: number[][] = [];
  const visit = (path: number[]) => {
    const ch = kids.get(path.join(","));
    if (!ch) return;
    if (mode === "exact" || ch.size >= 2) order.push(path);
    for (const c of ch) visit([...path, c]);
  };
  visit([]);
  const dist = new Map<string, NodeDist>();
  let requests = 0;
  let floored = 0;
  for (const path of order) {
    const need = kids.get(path.join(","))!;
    let d = await nextDist([...prompt, ...path], nProbs);
    requests++;
    if ([...need].some((c) => !d.lp.has(c))) {
      d = await nextDist([...prompt, ...path], 8192);
      requests++;
    }
    dist.set(path.join(","), d);
  }
  const logprobs: Record<string, number[]> = {};
  const nTokens: Record<string, number> = {};
  for (const a of answers) {
    const lps: number[] = [];
    for (let i = 0; i < a.ids.length; i++) {
      const d = dist.get(a.ids.slice(0, i).join(","));
      if (!d) continue; // branch mode, single-child node
      let v = d.lp.get(a.ids[i]);
      if (v === undefined) {
        floored++;
        v = d.minLp;
      }
      lps.push(v);
    }
    logprobs[a.key] = lps;
    nTokens[a.key] = a.ids.length;
  }
  return { logprobs, nTokens, requests, ms: performance.now() - t0, floored };
}
