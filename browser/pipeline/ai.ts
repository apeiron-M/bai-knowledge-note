/**
 * The AI the browser pipeline uses: the one the visitor connected in the chat (OpenRouter, a local
 * server, or Connect's settings), with the model the chat uses. Read per task, so a connection or
 * model changed between two sources is used for the second.
 */
import { fetchToolCapableModels, readStoredModel, resolveModel } from "../../editors/knowledge-vault/hooks/use-openrouter.js";
import { activeProvider, endpointFor, isLocalEndpoint, readSavedProviders } from "../../editors/knowledge-vault/lib/chat/provider.js";
import { LlmClient } from "../../pieces/knowledge-vault/lib/agent/llm.js";

/** The most model calls one source may cost. The stages' own second passes count too. */
export const CALL_BUDGET = 12;

/** The AI did not answer at all: stopped, offline, or a local server that does not allow this page. Queued sources wait. */
export class AiUnreachableError extends Error {
  constructor(cause?: unknown) {
    super("Can't reach your AI", { cause });
    this.name = "AiUnreachableError";
  }
}
/** The AI answered 401/402/403: the key is wrong, out of credit, or revoked. */
export class AiRefusedError extends Error {
  constructor() {
    super("Your AI refused the key");
    this.name = "AiRefusedError";
  }
}
/** The source used up its model calls (CALL_BUDGET) without a usable answer. */
export class CallBudgetError extends Error {
  constructor() {
    super("Your AI's answer could not be used");
    this.name = "CallBudgetError";
  }
}

/** A short one-way mark of a text (FNV-1a): tells two connections apart without keeping a key in view. */
function mark(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

export type PipelineAi = {
  llm: LlmClient;
  model: string;
  /** A model on the visitor's machine or network: smaller windows, longer timeouts. */
  local: boolean;
  /** "OpenRouter", the local server's host, … for the queue's handoffs. */
  label: string;
  fetchImpl: typeof fetch;
  /** Model calls this source has made. */
  calls(): number;
  /** Which connection this is — endpoint, key and model — as a one-way mark: a refused one is not asked again. */
  connection: string;
  /**
   * Whether the AI answers at all, asked before a task is touched, so a source waiting for an AI that
   * is off says so instead of "Processing". A GET of its model list: no model call, nothing spent.
   * Throws AiUnreachableError, or AiRefusedError for a key it turns away.
   */
  reach(): Promise<void>;
};

/**
 * The visitor's AI, or null when none is connected (or it names no model). `stop` ends its calls at
 * once: the runner aborts it on stop, so a Reset never waits for a slow model.
 */
export async function pipelineAi(stop?: AbortSignal): Promise<PipelineAi | null> {
  const provider = activeProvider(readSavedProviders());
  if (!provider) return null;
  const endpoint = endpointFor(provider);
  if (!endpoint) return null;
  const model =
    provider.kind === "openrouter"
      ? resolveModel(readStoredModel(), await fetchToolCapableModels().catch(() => [])).model
      : ((provider.kind === "custom" ? provider.model : null) ?? endpoint.pinnedModel ?? null);
  if (!model) return null;

  const baseUrl = endpoint.completionsUrl.replace(/\/chat\/completions$/, "");
  // A local server set up without a key sends no Authorization at all.
  const apiKey = ((endpoint.headers.Authorization as string | undefined) ?? "").replace(/^Bearer\s*/, "");
  let calls = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(init?.headers);
    // OpenRouter's attribution headers make a local server's CORS check fail; an empty key too.
    if (!endpoint.openRouter) {
      headers.delete("HTTP-Referer");
      headers.delete("X-Title");
    }
    if (/^Bearer\s*$/.test(headers.get("Authorization") ?? "")) headers.delete("Authorization");
    if (url === endpoint.completionsUrl) {
      if (calls >= CALL_BUDGET) throw new CallBudgetError();
      calls++;
    }
    const signal = stop && init?.signal ? AbortSignal.any([init.signal, stop]) : (init?.signal ?? stop);
    let response: Response;
    try {
      response = await fetch(input, { ...init, headers, ...(signal ? { signal } : {}) });
    } catch (error) {
      // What a browser says when nothing answered (refused, offline, blocked by CORS).
      if (error instanceof TypeError) throw new AiUnreachableError(error);
      throw error;
    }
    // 402: OpenRouter's "out of credit". The key is turned away either way.
    if (response.status === 401 || response.status === 402 || response.status === 403) throw new AiRefusedError();
    return response;
  }) as typeof fetch;

  return {
    llm: new LlmClient({ baseUrl, apiKey, defaultModel: model }, fetchImpl),
    model,
    local: isLocalEndpoint(baseUrl),
    label: endpoint.label,
    fetchImpl,
    calls: () => calls,
    connection: mark(`${baseUrl}\n${apiKey}\n${model}`),
    reach: async () => {
      const response = await fetchImpl(`${baseUrl}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
      // Only that it answered matters: OpenRouter's list is a megabyte.
      await response.body?.cancel().catch(() => undefined);
    },
  };
}
