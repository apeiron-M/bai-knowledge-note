/**
 * Turn a failed request into something the UI can act on.
 *
 * On OpenRouter the distinction that matters most is between two 429s that
 * look alike:
 *
 *  - **The account's free-request quota is spent** (20/min, 50/day — 1,000/day
 *    once $10 of credits has ever been bought). This applies across *every*
 *    free model on the key, and failed attempts count against it. Trying
 *    another free model here does not help; it burns tomorrow's quota. So
 *    this kind must never trigger a retry or a model switch.
 *
 *  - **One model's provider is throttling** — OpenRouter wraps these as
 *    "Provider returned error" with the provider named in `metadata`. Another
 *    model will answer fine.
 *
 * On any other endpoint the failures that matter are simpler: the key was
 * refused (401/403), the model is not there (404 — Ollama says so when a
 * model was never pulled), or the server could not be reached at all — which
 * in a browser is almost always CORS, so the message says how to allow the
 * origin.
 *
 * Nothing here retries. The only automation downstream is skipping an
 * unavailable OpenRouter model when choosing the *next* turn's default.
 */
import { ProviderError } from "./completions-client.js";
import { isLocalEndpoint } from "./provider.js";

export type FailureKind =
  | "credits"
  | "free-quota"
  | "model-unavailable"
  | "auth"
  | "unreachable"
  | "aborted"
  | "other";

export interface Failure {
  kind: FailureKind;
  /** Provider wording first, ours second — theirs is what the user can act on. */
  message: string;
}

function providerNamed(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as {
      error?: { metadata?: { provider_name?: unknown } };
    };
    return typeof parsed.error?.metadata?.provider_name === "string";
  } catch {
    return false;
  }
}

/** The endpoint facts the classifier needs when the request never got a response. */
export type EndpointHint = { label: string; completionsUrl?: string } | null;

function isNetworkError(err: unknown): boolean {
  return (
    err instanceof TypeError ||
    (err instanceof Error && /NetworkError|Failed to fetch|Load failed/i.test(err.message))
  );
}

export function classifyFailure(err: unknown, endpoint: EndpointHint = null): Failure {
  if (err instanceof DOMException && err.name === "AbortError") {
    return { kind: "aborted", message: "Stopped." };
  }

  if (err instanceof ProviderError) {
    const said = err.providerMessage || `HTTP ${err.status}`;

    if (err.status === 401 || err.status === 403) {
      return { kind: "auth", message: said };
    }

    if (err.status === 402) {
      return { kind: "credits", message: said };
    }

    if (err.status === 429) {
      if (!err.openRouter) return { kind: "model-unavailable", message: said };
      // An upstream provider named in the body is that model's limit, not
      // the account's. Anything else at 429 is treated as the account quota:
      // the safe default, because retrying against a spent quota is the one
      // outcome that makes things worse.
      return providerNamed(err.raw)
        ? { kind: "model-unavailable", message: said }
        : { kind: "free-quota", message: said };
    }

    if (err.status >= 500 || err.status === 404 || /no endpoints/i.test(said)) {
      return { kind: "model-unavailable", message: said };
    }

    return { kind: "other", message: said };
  }

  if (isNetworkError(err)) {
    const label = endpoint?.label ?? "the model endpoint";
    const detail = err instanceof Error ? err.message : String(err);
    const origin = typeof location === "undefined" ? "this app" : location.origin;
    const local = endpoint?.completionsUrl ? isLocalEndpoint(endpoint.completionsUrl) : false;
    return {
      kind: "unreachable",
      message: local
        ? `Could not reach ${label} (${detail}). Is the server running, and does it allow browser requests from ${origin}? Ollama: start it with OLLAMA_ORIGINS="${origin}". LM Studio: enable CORS in the server settings.`
        : `Could not reach ${label} (${detail}). Check the address and your connection; if the server is yours, it must allow requests from ${origin}.`,
    };
  }

  if (err instanceof Error) return { kind: "other", message: err.message };
  return { kind: "other", message: String(err) };
}
