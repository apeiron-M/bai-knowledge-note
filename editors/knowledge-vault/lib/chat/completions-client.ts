/**
 * Streaming client for an OpenAI-compatible chat-completions endpoint.
 *
 * Plain `fetch` + `TextDecoder`, no SDK, so it runs against OpenRouter and
 * against whatever is listening on localhost alike. Verified browser-callable
 * against OpenRouter (preflight answers `access-control-allow-origin: *`);
 * a local server has to allow the Connect origin itself — see the CORS hint
 * the failure classifier attaches when it cannot be reached.
 *
 * Things this has to get right that a naive implementation misses:
 *
 *  - SSE frames are not aligned to network chunks. A single JSON event can be
 *    split across two `read()` calls, so bytes are buffered and only complete
 *    `\n\n`-terminated events are parsed.
 *  - Tool-call arguments stream as JSON *string fragments* keyed by `index`.
 *    Each fragment appends to the call at that index; parsing before the
 *    stream finishes would fail on every partial frame.
 *  - Some local servers omit `index` (Ollama) or answer a `stream: true`
 *    request with one plain JSON completion (older llama.cpp builds, some
 *    gateways). Both are accepted: id-keyed calls are kept apart, and a body
 *    that never contained an SSE event is read as a whole completion.
 *  - Reasoning models (Qwen3, DeepSeek-R1 and their GGUF servings) think out
 *    loud, either in a separate `reasoning_content` delta or inline between
 *    `<think>` tags. Neither is part of the answer: the field is ignored and
 *    the tags are filtered out even when a tag straddles two chunks.
 */
import type { ChatEndpoint } from "./provider.js";

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
 * A non-OK response from the endpoint, with enough structure for callers to
 * tell "add credits" from "this model is down" from "wrong key" from "today's
 * free quota is spent". The provider's own wording is preserved: only the
 * user can act on a billing message, so paraphrasing it would lose
 * information.
 */
export class ProviderError extends Error {
  readonly status: number;
  readonly providerMessage: string;
  readonly raw: string;
  /** The endpoint's label, e.g. "OpenRouter" or "localhost:11434". */
  readonly provider: string;
  /** Whether OpenRouter's quota/credit semantics apply to this status. */
  readonly openRouter: boolean;
  constructor(
    status: number,
    providerMessage: string,
    raw: string,
    provider = "OpenRouter",
    openRouter = provider === "OpenRouter",
  ) {
    super(`${provider} ${status}: ${providerMessage || "request failed"}`);
    this.name = "ProviderError";
    this.status = status;
    this.providerMessage = providerMessage;
    this.raw = raw;
    this.provider = provider;
    this.openRouter = openRouter;
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
    delta?: {
      content?: string | null;
      /** Reasoning models' scratchpad (DeepSeek/Qwen servers); not answer text. */
      reasoning_content?: string | null;
      tool_calls?: DeltaToolCall[];
    };
    finish_reason?: string | null;
  }[];
}

/** One whole (non-streamed) completion, as a server that ignored `stream` returns it. */
interface Completion {
  model?: string;
  choices?: {
    message?: { content?: string | null; tool_calls?: DeltaToolCall[] };
    finish_reason?: string | null;
  }[];
}

/**
 * Drops `<think>…</think>` spans from a stream of text deltas, remembering
 * whether it is inside one between calls. A tag split across chunks is held
 * back until it can be recognised, so no half-tag ever reaches the reader.
 */
export class ThinkFilter {
  private inside = false;
  private pending = "";

  push(delta: string): string {
    let s = this.pending + delta;
    this.pending = "";
    let out = "";
    for (;;) {
      if (this.inside) {
        const end = s.indexOf("</think>");
        if (end === -1) {
          this.pending = tailThatMightStart(s, "</think>");
          return out;
        }
        s = s.slice(end + "</think>".length);
        this.inside = false;
        // A newline the model puts right after its thoughts is not content.
        s = s.replace(/^\s*\n/, "");
      } else {
        const start = s.indexOf("<think>");
        if (start === -1) {
          const held = tailThatMightStart(s, "<think>");
          out += s.slice(0, s.length - held.length);
          this.pending = held;
          return out;
        }
        out += s.slice(0, start);
        s = s.slice(start + "<think>".length);
        this.inside = true;
      }
    }
  }

  /** Whatever was held back at the end of the stream that turned out not to be a tag. */
  flush(): string {
    const rest = this.inside ? "" : this.pending;
    this.pending = "";
    return rest;
  }
}

/** The longest suffix of `s` that is a proper prefix of `tag`. */
function tailThatMightStart(s: string, tag: string): string {
  for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) {
    if (tag.startsWith(s.slice(s.length - n))) return s.slice(s.length - n);
  }
  return "";
}

/**
 * Accumulates tool calls across frames. Keyed by `index` when the server
 * sends one; otherwise by `id`, with an id-less fragment continuing the most
 * recent call — which is how servers that omit `index` stream arguments.
 */
class ToolCallAssembler {
  private readonly byIndex = new Map<number, ToolCall>();
  private readonly indexById = new Map<string, number>();
  private last = -1;

  add(tc: DeltaToolCall): void {
    let idx: number;
    if (typeof tc.index === "number") idx = tc.index;
    else if (tc.id && this.indexById.has(tc.id)) idx = this.indexById.get(tc.id)!;
    else if (tc.id) idx = this.byIndex.size;
    else idx = Math.max(0, this.last);
    this.last = idx;
    const call = this.byIndex.get(idx) ?? {
      id: "",
      type: "function" as const,
      function: { name: "", arguments: "" },
    };
    if (tc.id) {
      call.id = tc.id;
      this.indexById.set(tc.id, idx);
    }
    if (tc.function?.name) call.function.name = tc.function.name;
    if (tc.function?.arguments) call.function.arguments += tc.function.arguments;
    this.byIndex.set(idx, call);
  }

  get size(): number {
    return this.byIndex.size;
  }

  list(): ToolCall[] {
    return [...this.byIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, call]) => call);
  }
}

export async function streamChat(opts: {
  endpoint: ChatEndpoint;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  toolChoice?: "auto" | "none";
  /**
   * Models OpenRouter may fall back to, in priority order, when `model` is
   * rate-limited, down, or rejects the request. Failover happens server-side
   * within this one request — no client retries, so a failed attempt is
   * never multiplied against the account's free-request quota. Ignored for
   * every other endpoint: the field is OpenRouter's, not OpenAI's.
   */
  fallbackModels?: string[];
  signal?: AbortSignal;
  onText?: (delta: string) => void;
}): Promise<StreamResult> {
  const { endpoint } = opts;
  const res = await fetch(endpoint.completionsUrl, {
    method: "POST",
    signal: opts.signal,
    headers: {
      ...endpoint.headers,
      "Content-Type": "application/json",
      // Optional attribution headers OpenRouter uses for its rankings.
      ...(endpoint.openRouter
        ? { "HTTP-Referer": location.origin, "X-Title": "Powerhouse Knowledge Vault" }
        : {}),
    },
    body: JSON.stringify({
      // The server's own knobs first, so nothing below can be overridden.
      ...(endpoint.extraBody ?? {}),
      model: opts.model,
      ...(endpoint.openRouter && opts.fallbackModels?.length
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
    // OpenAI-style `{error:{message}}`, or a bare `{error:"…"}` as some
    // local servers answer; anything else is shown as the raw body.
    let message = raw;
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } | string };
      if (typeof parsed.error === "string") message = parsed.error;
      else if (parsed.error?.message) message = parsed.error.message;
    } catch {
      /* keep the raw body */
    }
    throw new ProviderError(
      res.status,
      message,
      raw,
      endpoint.label,
      endpoint.openRouter,
    );
  }
  if (!res.body) throw new Error(`${endpoint.label} returned no response body`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const calls = new ToolCallAssembler();
  const think = new ThinkFilter();
  let finishReason: string | null = null;
  let model: string | null = null;
  let sawEvent = false;
  const emit = (delta: string) => {
    if (!delta) return;
    text += delta;
    opts.onText?.(delta);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const { events, rest } = parseSseChunk(buffer);
    buffer = rest;

    for (const event of events) {
      sawEvent = true;
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
      if (delta?.content) emit(think.push(delta.content));
      for (const tc of delta?.tool_calls ?? []) calls.add(tc);
    }
  }
  emit(think.flush());

  // A server that ignored `stream: true` sends one JSON completion and no
  // SSE event at all; it sits whole in the buffer when the body ends.
  if (!sawEvent && buffer.trim()) {
    try {
      const whole = JSON.parse(buffer) as Completion;
      const choice = whole.choices?.[0];
      if (choice) {
        if (whole.model) model = whole.model;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const content = choice.message?.content;
        if (typeof content === "string" && content) {
          const whole = new ThinkFilter();
          emit(whole.push(content) + whole.flush());
        }
        for (const tc of choice.message?.tool_calls ?? []) calls.add(tc);
      }
    } catch {
      /* not a completion either; return what streamed (nothing) */
    }
  }

  return { text, toolCalls: calls.list(), finishReason, model };
}
