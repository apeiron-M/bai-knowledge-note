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
