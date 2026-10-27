/**
 * Configuration C's DecisionBackend over native llama-server (node parity
 * only; nothing in the tab imports this). CompleteJson / ScoreText are the
 * eval rig's lib.ts request bodies verbatim; nextDist / forcedLogprob send
 * the same string prompts as the browser, so parity exercises the shipped
 * code path, not lib.ts's token-id prompts.
 */
import type { KevBackend, LoraBackend, NextDist } from "./decision-backend.js";
import type { CompleteJson, ScoreText } from "./llm-client.js";
import { asSystemOneResponse } from "./wllama-backend.js";
import type { WllamaLogprobContent, WllamaTimings } from "./wllama-types.js";

export class RateLimited extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function serverPost(
  base: string,
  route: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(base + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new RateLimited(`429 on ${route}`);
  if (!res.ok) throw new Error(`${route}: ${res.status} ${await res.text()}`);
  const j: unknown = await res.json();
  if (!isRecord(j)) throw new Error(`${route}: not a JSON object`);
  return j;
}

interface ChatChoice {
  content: string;
  finishReason: string | null;
  logprobs: WllamaLogprobContent[];
}

function firstChoice(res: Record<string, unknown>): ChatChoice {
  const c: unknown = Array.isArray(res.choices) ? res.choices[0] : undefined;
  const msg = isRecord(c) && isRecord(c.message) ? c.message : {};
  const lp = isRecord(c) && isRecord(c.logprobs) ? c.logprobs.content : null;
  return {
    content: typeof msg.content === "string" ? msg.content : "",
    finishReason: isRecord(c) && typeof c.finish_reason === "string" ? c.finish_reason : null,
    // llama-server's OAI logprob objects, as wllama returns them
    logprobs: Array.isArray(lp) ? lp.filter(isRecord).map(asLogprobContent) : [],
  };
}

function asLogprobContent(t: Record<string, unknown>): WllamaLogprobContent {
  const one = (x: Record<string, unknown>) => ({
    token: typeof x.token === "string" ? x.token : "",
    logprob: typeof x.logprob === "number" ? x.logprob : Number.NaN,
    bytes: Array.isArray(x.bytes) ? x.bytes.map(Number) : null,
  });
  return {
    ...one(t),
    top_logprobs: Array.isArray(t.top_logprobs)
      ? t.top_logprobs.filter(isRecord).map(one)
      : [],
  };
}

function timingsOf(res: Record<string, unknown>): WllamaTimings | undefined {
  const t = res.timings;
  if (!isRecord(t)) return undefined;
  const n = (k: string) => (typeof t[k] === "number" ? t[k] : 0);
  return {
    cache_n: n("cache_n"),
    prompt_n: n("prompt_n"),
    prompt_ms: n("prompt_ms"),
    prompt_per_second: n("prompt_per_second"),
    predicted_n: n("predicted_n"),
    predicted_ms: n("predicted_ms"),
    predicted_per_second: n("predicted_per_second"),
  };
}

/** The LoRA on a llama-server started with `-c 4096 -np 1 --no-jinja`. */
export function serverLora(base: string): LoraBackend {
  const completeJson: CompleteJson = async (messages, constraint, o = {}) => {
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
    const res = await serverPost(base, "/v1/chat/completions", body);
    const c = firstChoice(res);
    const out = {
      text: c.content,
      chunks: 1,
      finishReason: c.finishReason,
      timings: timingsOf(res),
      timingsOnLastChunk: true,
      wallMs: performance.now() - t0,
    };
    try {
      return { ...out, parsed: JSON.parse(c.content) as unknown };
    } catch (err) {
      return { ...out, parsed: undefined, parseError: String(err) };
    }
  };

  const scoreText: ScoreText = async (messages, grammar, o = {}) => {
    const t0 = performance.now();
    const res = await serverPost(base, "/v1/chat/completions", {
      messages,
      stream: false,
      max_tokens: o.maxTokens ?? 48,
      temperature: 0,
      grammar: grammar || undefined,
      logprobs: true,
      top_logprobs: o.topLogprobs ?? 1,
    });
    const c = firstChoice(res);
    return {
      text: c.content,
      tokens: c.logprobs,
      finishReason: c.finishReason,
      timings: timingsOf(res),
      wallMs: performance.now() - t0,
    };
  };

  /** `completion_probabilities[0]` of a one-token /completion. */
  const step = async (body: Record<string, unknown>) => {
    const res = await serverPost(base, "/completion", {
      n_predict: 1,
      temperature: 0,
      cache_prompt: true,
      return_tokens: false,
      ...body,
    });
    const cp: unknown = Array.isArray(res.completion_probabilities)
      ? res.completion_probabilities[0]
      : undefined;
    return isRecord(cp) ? cp : {};
  };

  return {
    completeJson,
    scoreText,
    nextDist: async (prompt, nProbs): Promise<NextDist> => {
      const cp = await step({ prompt, n_probs: nProbs });
      const lp = new Map<number, number>();
      let minLp = 0;
      for (const t of Array.isArray(cp.top_logprobs) ? cp.top_logprobs : []) {
        if (!isRecord(t) || typeof t.id !== "number" || typeof t.logprob !== "number")
          continue;
        lp.set(t.id, t.logprob);
        minLp = Math.min(minLp, t.logprob);
      }
      return { lp, minLp };
    },
    forcedLogprob: async (prompt, id) => {
      const cp = await step({ prompt, n_probs: 1, logit_bias: [[id, 100]] });
      if (cp.id !== id || typeof cp.logprob !== "number")
        throw new Error(`forced token ${id} sampled ${String(cp.id)}`);
      return cp.logprob;
    },
  };
}

/** Kev-FT on a llama-server started with `-c 8192` (rig settings). */
export function serverKev(base: string): KevBackend {
  return {
    systemOne: async (body) =>
      asSystemOneResponse(await serverPost(base, "/v1/systemone", body)),
  };
}
