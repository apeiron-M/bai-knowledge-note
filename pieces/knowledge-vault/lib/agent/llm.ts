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
    if (!response.ok) throw await llmError(response, `ask ${request.model}`);
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
