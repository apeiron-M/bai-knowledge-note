import type { LlmCredentials } from "../common/auth-value.js";
import { KnowledgeVaultApiError } from "../common/errors.js";

/**
 * A minimal OpenAI-compatible chat client: model listing and tool-calling
 * completions. Plain fetch, no SDK, so it runs in the piece worker and against
 * OpenRouter, OpenAI or any gateway that speaks the same API.
 */

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ToolSchema = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type Usage = { prompt_tokens: number; completion_tokens: number; cost: number };

export type ModelInfo = {
  id: string;
  name: string;
  contextLength: number | null;
  /** US dollars per million tokens, when the provider publishes prices. */
  inputPerM: number | null;
  outputPerM: number | null;
  supportsTools: boolean;
};

const CHAT_TIMEOUT_MS = 180_000;
/**
 * One staged call: a normal answer takes 5-60 s. Two attempts of 120 s fit
 * inside a step's 300 s timeout, so a call that hangs is retried instead of
 * taking the whole step down.
 */
export const JSON_CALL_TIMEOUT_MS = 120_000;

export class LlmClient {
  constructor(
    readonly credentials: LlmCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.credentials.apiKey}`,
      "Content-Type": "application/json",
      // OpenRouter attributes usage to the app with these; others ignore them.
      "HTTP-Referer": "https://powerhouse.inc",
      "X-Title": "Powerhouse Knowledge Vault",
    };
  }

  /** Tool-capable models first-class: the agent jobs cannot run without tools. */
  async listModels(toolsOnly = true): Promise<ModelInfo[]> {
    const url = `${this.credentials.baseUrl}/models${toolsOnly ? "?supported_parameters=tools" : ""}`;
    const response = await this.fetchImpl(url, { headers: this.headers(), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw await llmError(response, "list models");
    const body = (await response.json()) as { data?: unknown[] };
    const models = (body.data ?? []).map(toModelInfo).filter((m): m is ModelInfo => m !== null);
    // A provider that ignores the filter is filtered here; one that reports no
    // supported_parameters at all keeps every model rather than none.
    const knowsTools = models.some((m) => m.supportsTools);
    return (toolsOnly && knowsTools ? models.filter((m) => m.supportsTools) : models).sort((a, b) => a.name.localeCompare(b.name));
  }

  async chat(request: { model: string; messages: ChatMessage[]; tools: ToolSchema[]; temperature?: number }): Promise<{
    message: Extract<ChatMessage, { role: "assistant" }>;
    usage: Usage;
    finishReason: string | null;
  }> {
    const response = await this.fetchImpl(`${this.credentials.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        tools: request.tools,
        tool_choice: "auto",
        temperature: request.temperature ?? 0.2,
        // OpenRouter returns the request's cost in usage.cost when asked.
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    if (!response.ok) throw await llmError(response, `chat with ${request.model}`);
    const body = (await response.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string | null }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      error?: { message?: string };
    };
    if (body.error) {
      throw new KnowledgeVaultApiError(`The model provider refused the request: ${body.error.message ?? "unknown error"}`, { category: "server", retryable: true });
    }
    const choice = body.choices?.[0];
    const message = choice?.message ?? {};
    return {
      message: {
        role: "assistant",
        content: message.content ?? null,
        ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
      },
      usage: {
        prompt_tokens: body.usage?.prompt_tokens ?? 0,
        completion_tokens: body.usage?.completion_tokens ?? 0,
        cost: body.usage?.cost ?? 0,
      },
      finishReason: choice?.finish_reason ?? null,
    };
  }
}

/**
 * One JSON answer, no tools: the staged jobs each make a single bounded call.
 * Reasoning models spend part of max_tokens thinking; a reply cut off before
 * any answer ("length" with empty content) is retried once with double the
 * budget, and said plainly if it happens again.
 */
export async function completeJson(
  client: LlmClient,
  request: { model: string; system: string; user: string; maxTokens?: number; reasoningEffort?: "low" | "medium" | "high"; timeoutMs?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<{ value: unknown; usage: Usage }> {
  const { baseUrl, apiKey } = client.credentials;
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, cost: 0 };
  let budget = request.maxTokens ?? 32_000;
  const timeoutMs = request.timeoutMs ?? JSON_CALL_TIMEOUT_MS;
  for (let attempt = 1; ; attempt++) {
    // A hang, or a connection dropped before or while the answer arrives, gets one more try.
    const retryable = (error: unknown) => attempt < 2 && (isTimeout(error) || isDroppedConnection(error));
    const fail = (error: unknown): never => {
      if (isTimeout(error)) throw new KnowledgeVaultApiError(`${request.model} did not answer within ${Math.round(timeoutMs / 1000)} s, twice. Run the step again, or choose a faster model.`, { category: "timeout", retryable: true });
      throw error;
    };
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://powerhouse.inc", "X-Title": "Powerhouse Knowledge Vault" },
        body: JSON.stringify({
          model: request.model,
          messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: budget,
          ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
          usage: { include: true },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (retryable(error)) continue;
      return fail(error);
    }
    if (!response.ok) {
      // A rate limit or a provider hiccup (429, 5xx) is waited out once; parallel runs and batches hit it.
      if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
        await response.text().catch(() => "");
        await sleep(retryDelayMs(response));
        continue;
      }
      throw await llmError(response, `ask ${request.model}`);
    }
    let body: { choices?: { message?: { content?: string | null }; finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; error?: { message?: string } } | null;
    try {
      body = (await response.json()) as typeof body;
    } catch (error) {
      if (retryable(error)) continue;
      return fail(error);
    }
    if (!body) {
      // An empty body is an empty answer: once more, then say so.
      if (attempt < 2) continue;
      throw new KnowledgeVaultApiError(`${request.model} returned an empty response twice`, { category: "server", retryable: true });
    }
    if (body.error) throw new KnowledgeVaultApiError(`The model provider refused the request: ${body.error.message ?? "unknown error"}`, { category: "server", retryable: true });
    usage.prompt_tokens += body.usage?.prompt_tokens ?? 0;
    usage.completion_tokens += body.usage?.completion_tokens ?? 0;
    usage.cost += body.usage?.cost ?? 0;
    const choice = body.choices?.[0];
    const text = choice?.message?.content ?? "";
    if (!text.trim()) {
      if (attempt < 2) {
        budget *= 2;
        continue;
      }
      const why = choice?.finish_reason === "length" ? `it used its whole ${budget}-token budget before answering (reasoning models think first)` : `it returned an empty answer (finish reason: ${choice?.finish_reason ?? "none"})`;
      throw new KnowledgeVaultApiError(`${request.model} gave no answer twice: ${why}. Try a larger model or a shorter source.`, { category: "server", retryable: true });
    }
    try {
      return { value: parseJsonAnswer(text), usage };
    } catch (error) {
      // A reply that is not JSON is retried once, like an empty one.
      if (attempt < 2) continue;
      throw error;
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry-After in seconds when the provider sends it, else 5 s; never more than 30 s. */
export function retryDelayMs(response: { headers: { get(name: string): string | null } }): number {
  const header = response.headers.get("retry-after");
  const seconds = header === null || header.trim() === "" ? NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 30) * 1000 : 5000;
}

/** AbortSignal.timeout rejects with a TimeoutError, both on the request and while the body is read. */
export function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" || /aborted due to timeout/i.test(error.message));
}

/** Node's fetch reports a connection the other side dropped as "terminated" or "fetch failed". */
export function isDroppedConnection(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`;
  return /terminated|fetch failed|socket hang up|ECONNRESET|other side closed|UND_ERR/i.test(text);
}

/** Models wrap JSON in fences or prose now and then; take the outermost object. */
export function parseJsonAnswer(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new KnowledgeVaultApiError("The model did not answer with JSON", { category: "server", retryable: true, detail: text.slice(0, 300) });
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new KnowledgeVaultApiError("The model answered with malformed JSON", { category: "server", retryable: true, detail: text.slice(0, 300) });
  }
}

function toModelInfo(raw: unknown): ModelInfo | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as { id?: unknown; name?: unknown; context_length?: unknown; pricing?: { prompt?: unknown; completion?: unknown }; supported_parameters?: unknown };
  if (typeof m.id !== "string") return null;
  const perM = (v: unknown) => {
    const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 100) / 100 : null;
  };
  return {
    id: m.id,
    name: typeof m.name === "string" ? m.name : m.id,
    contextLength: typeof m.context_length === "number" ? m.context_length : null,
    inputPerM: perM(m.pricing?.prompt),
    outputPerM: perM(m.pricing?.completion),
    supportsTools: Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools"),
  };
}

/** `DeepSeek V4.1 Flash — $0.30 / $1.20 per M · 1049k ctx` */
export function modelLabel(m: ModelInfo): string {
  const price = m.inputPerM !== null && m.outputPerM !== null ? ` — $${m.inputPerM.toFixed(2)} / $${m.outputPerM.toFixed(2)} per M` : "";
  const ctx = m.contextLength ? ` · ${Math.round(m.contextLength / 1000)}k ctx` : "";
  return `${m.name}${price}${ctx}`;
}

async function llmError(response: Response, what: string): Promise<KnowledgeVaultApiError> {
  const text = await response.text().catch(() => "");
  let message = text.slice(0, 300);
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string };
    message = typeof body.error === "string" ? body.error : (body.error?.message ?? message);
  } catch {
    // keep the raw text
  }
  const category = response.status === 401 || response.status === 403 ? "credential" : response.status === 402 ? "rate_limit" : response.status === 429 ? "rate_limit" : response.status >= 500 ? "server" : "validation";
  return new KnowledgeVaultApiError(`The model provider refused to ${what} (${response.status}): ${message}`, {
    status: response.status,
    category,
    retryable: category === "server" || response.status === 429,
  });
}

// ── Choosing a model for the vault's staged jobs ────────────────────────

/** A model is offered by default when it can do the job and is cheap. */
export const MODEL_CRITERIA = {
  /** Artificial Analysis intelligence index, from OpenRouter's model list. */
  minIntelligence: 35,
  /** US dollars per million output tokens; free models always pass. */
  maxOutputPerM: 2,
} as const;

/**
 * Measured on the candidates prompt of a real source (2026-09-29): seconds
 * per stage, or `slow` for a model that reasons at length whatever effort it
 * is asked for (DeepSeek V4.1 Flash wrote 6,000-14,000 reasoning tokens at
 * "low", 35-90 s a call, and some of its providers never answered).
 */
export const TESTED_MODELS: Record<string, { seconds: number } | { slow: true }> = {
  "openai/gpt-6-luna": { seconds: 10 },
  "z-ai/glm-5.3-flash": { seconds: 5 },
  "google/gemini-3.8-flash": { seconds: 6 },
  "anthropic/claude-sonnet-5.5": { seconds: 6 },
  "openai/gpt-6-sol": { seconds: 13 },
  "deepseek/deepseek-v4.1-flash": { slow: true },
  "x-ai/grok-4.7": { slow: true },
};

export type VaultModel = {
  id: string;
  name: string;
  intelligence: number | null;
  inputPerM: number;
  outputPerM: number;
  free: boolean;
  /** Median tokens per second across the providers that serve it with JSON output, when known. */
  tokensPerSecond: number | null;
  tested: { seconds: number } | { slow: true } | null;
};

type RawModel = { id?: unknown; name?: unknown; pricing?: { prompt?: unknown; completion?: unknown }; benchmarks?: { artificial_analysis?: { intelligence_index?: unknown } } | null };

const perMillion = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n * 1e6 : Number.POSITIVE_INFINITY;
};

/**
 * The models worth offering for the staged jobs: they reason, answer in
 * JSON, score at least minIntelligence and cost at most maxOutputPerM (free
 * ones always, if they qualify on the rest). A free variant is scored by its
 * paid twin. Tested models come first with their measured time, untested
 * ones by score, slow ones last. With a search term, every reasoning + JSON
 * model matching it is listed, however expensive, so a stronger model is one
 * search away. Other providers than OpenRouter get their plain model list.
 */
export async function vaultModels(llm: LlmClient, search = "", fetchImpl: typeof fetch = fetch): Promise<VaultModel[]> {
  const { baseUrl, apiKey } = llm.credentials;
  const term = search.trim().toLowerCase();
  if (!/openrouter\.ai/i.test(baseUrl)) {
    const plain = await llm.listModels(false);
    return plain
      .filter((m) => !term || m.id.toLowerCase().includes(term) || m.name.toLowerCase().includes(term))
      .map((m) => ({ id: m.id, name: m.name, intelligence: null, inputPerM: m.inputPerM ?? Number.POSITIVE_INFINITY, outputPerM: m.outputPerM ?? Number.POSITIVE_INFINITY, free: false, tokensPerSecond: null, tested: TESTED_MODELS[m.id] ?? null }));
  }
  const headers = { Authorization: `Bearer ${apiKey}` };
  const response = await fetchImpl(`${baseUrl}/models?supported_parameters=reasoning,response_format`, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw await llmError(response, "list models");
  const raw = ((await response.json()) as { data?: RawModel[] }).data ?? [];
  const iqOf = new Map(raw.map((m) => [String(m.id), m.benchmarks?.artificial_analysis?.intelligence_index]));
  const models: VaultModel[] = raw
    .filter((m) => typeof m.id === "string" && !m.id.endsWith(":batch"))
    .map((m) => {
      const id = String(m.id);
      const score = iqOf.get(id) ?? iqOf.get(id.replace(/:free$/, ""));
      const inputPerM = perMillion(m.pricing?.prompt);
      const outputPerM = perMillion(m.pricing?.completion);
      return { id, name: typeof m.name === "string" ? m.name : id, intelligence: typeof score === "number" ? score : null, inputPerM, outputPerM, free: inputPerM === 0 && outputPerM === 0, tokensPerSecond: null, tested: TESTED_MODELS[id] ?? null };
    });
  const listed = term
    ? models.filter((m) => m.id.toLowerCase().includes(term) || m.name.toLowerCase().includes(term))
    : models.filter((m) => (m.intelligence ?? 0) >= MODEL_CRITERIA.minIntelligence && (m.free || m.outputPerM <= MODEL_CRITERIA.maxOutputPerM));
  // Speed from the providers that serve the model with JSON output: a few calls, in parallel.
  const speedFor = listed.slice(0, 25);
  await Promise.all(
    speedFor.map(async (m) => {
      try {
        const r = await fetchImpl(`${baseUrl}/models/${m.id}/endpoints`, { headers, signal: AbortSignal.timeout(10_000) });
        if (!r.ok) return;
        const eps = ((await r.json()) as { data?: { endpoints?: { supported_parameters?: string[]; throughput_last_30m?: { p50?: number } | null }[] } }).data?.endpoints ?? [];
        const tps = eps.filter((e) => e.supported_parameters?.includes("response_format")).map((e) => e.throughput_last_30m?.p50 ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
        m.tokensPerSecond = tps.length ? Math.round(tps[Math.floor(tps.length / 2)] ?? 0) : null;
      } catch {
        // speed stays unknown
      }
    }),
  );
  const rank = (m: VaultModel) => (m.tested && "seconds" in m.tested ? 0 : m.tested ? 2 : 1);
  return listed.sort((a, b) => rank(a) - rank(b) || (a.tested && "seconds" in a.tested && b.tested && "seconds" in b.tested ? a.tested.seconds - b.tested.seconds : 0) || (b.intelligence ?? 0) - (a.intelligence ?? 0) || a.name.localeCompare(b.name));
}

/** `GPT-6 Luna — IQ 37 · $0.05 / $0.25 per M · tested: 10 s a stage` */
export function vaultModelLabel(m: VaultModel): string {
  const parts = [
    m.intelligence !== null ? `IQ ${Math.round(m.intelligence)}` : null,
    m.free ? "free" : Number.isFinite(m.outputPerM) ? `$${m.inputPerM.toFixed(2)} / $${m.outputPerM.toFixed(2)} per M` : null,
    m.tested ? ("seconds" in m.tested ? `tested: ${m.tested.seconds} s a stage` : "slow here: reasons at length") : m.tokensPerSecond ? `~${m.tokensPerSecond} tok/s` : null,
    !m.free && Number.isFinite(m.outputPerM) && m.outputPerM > MODEL_CRITERIA.maxOutputPerM ? "not a cheap model" : null,
  ].filter(Boolean);
  return parts.length ? `${m.name} — ${parts.join(" · ")}` : m.name;
}
