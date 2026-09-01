/**
 * Streaming client for OpenRouter's chat-completions endpoint.
 *
 * Plain `fetch` + `TextDecoder`, no SDK. Verified browser-callable: the
 * endpoint answers preflight with `access-control-allow-origin: *` and allows
 * the `Authorization` header.
 *
 * Two things this has to get right that a naive implementation misses:
 *
 *  - SSE frames are not aligned to network chunks. A single JSON event can be
 *    split across two `read()` calls, so bytes are buffered and only complete
 *    `\n\n`-terminated events are parsed.
 *  - Tool-call arguments stream as JSON *string fragments* keyed by `index`.
 *    Each fragment appends to the call at that index; parsing before the
 *    stream finishes would fail on every partial frame.
 */

const COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * OpenRouter rejects a `models` array longer than this — and the count
 * includes the primary. Enforced here, at the request boundary, so no caller
 * can reintroduce a 400 by choosing one fallback too many.
 */
export const MAX_MODELS_IN_REQUEST = 3;

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface StreamResult {
  text: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  /** The model that actually answered — differs from the request when OpenRouter fell back. */
  model: string | null;
}

/**
 * A non-OK response from OpenRouter, with enough structure for callers to
 * tell "add credits" from "this model is down" from "today's free quota is
 * spent". The provider's own wording is preserved: only the user can act on
 * a billing message, so paraphrasing it would only lose information.
 */
export class OpenRouterError extends Error {
  readonly status: number;
  readonly providerMessage: string;
  readonly raw: string;
  constructor(status: number, providerMessage: string, raw: string) {
    super(`OpenRouter ${status}: ${providerMessage || "request failed"}`);
    this.name = "OpenRouterError";
    this.status = status;
    this.providerMessage = providerMessage;
    this.raw = raw;
  }
}

/**
 * Split a buffer on SSE event boundaries, returning the incomplete tail.
 * Accepts both `\n\n` and `\r\n\r\n` delimiters.
 */
export function parseSseChunk(buffer: string): {
  events: string[];
  rest: string;
} {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  return { events: parts.filter((p) => p.trim().length > 0), rest };
}

interface DeltaToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface StreamFrame {
  model?: string;
  choices?: {
    delta?: { content?: string; tool_calls?: DeltaToolCall[] };
    finish_reason?: string | null;
  }[];
}

export async function streamChat(opts: {
  key: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  toolChoice?: "auto" | "none";
  /**
   * Models OpenRouter may fall back to, in priority order, when `model` is
   * rate-limited, down, or rejects the request. Failover happens server-side
   * within this one request — no client retries, so a failed attempt is
   * never multiplied against the account's free-request quota.
   */
  fallbackModels?: string[];
  signal?: AbortSignal;
  onText?: (delta: string) => void;
}): Promise<StreamResult> {
  const res = await fetch(COMPLETIONS_URL, {
    method: "POST",
    signal: opts.signal,
    headers: {
      Authorization: `Bearer ${opts.key}`,
      "Content-Type": "application/json",
      // Optional attribution headers OpenRouter uses for its rankings.
      "HTTP-Referer": location.origin,
      "X-Title": "Powerhouse Knowledge Vault",
    },
    body: JSON.stringify({
      model: opts.model,
      ...(opts.fallbackModels?.length
        ? {
            models: [opts.model, ...opts.fallbackModels].slice(
              0,
              MAX_MODELS_IN_REQUEST,
            ),
          }
        : {}),
      messages: opts.messages,
      stream: true,
      ...(opts.tools?.length
        ? { tools: opts.tools, tool_choice: opts.toolChoice ?? "auto" }
        : {}),
    }),
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let message = raw;
    try {
      message =
        (JSON.parse(raw) as { error?: { message?: string } }).error?.message ??
        raw;
    } catch {
      /* keep the raw body */
    }
    throw new OpenRouterError(res.status, message, raw);
  }
  if (!res.body) throw new Error("OpenRouter returned no response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const partial = new Map<number, ToolCall>();
  let finishReason: string | null = null;
  let model: string | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const { events, rest } = parseSseChunk(buffer);
    buffer = rest;

    for (const event of events) {
      const line = event.split(/\r?\n/).find((l) => l.startsWith("data:"));
      if (!line) continue; // comment frame such as ": OPENROUTER PROCESSING"
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;

      let frame: StreamFrame;
      try {
        frame = JSON.parse(payload) as StreamFrame;
      } catch {
        continue; // a keep-alive or malformed frame must not kill the stream
      }

      if (frame.model) model = frame.model;
      const choice = frame.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;

      const delta = choice.delta;
      if (delta?.content) {
        text += delta.content;
        opts.onText?.(delta.content);
      }

      for (const tc of delta?.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const existing = partial.get(idx) ?? {
          id: "",
          type: "function" as const,
          function: { name: "", arguments: "" },
        };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name = tc.function.name;
        if (tc.function?.arguments)
          existing.function.arguments += tc.function.arguments;
        partial.set(idx, existing);
      }
    }
  }

  return {
    text,
    toolCalls: [...partial.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, call]) => call),
    finishReason,
    model,
  };
}
