/**
 * Turn a failed OpenRouter request into something the UI can act on.
 *
 * The distinction that matters most is between two 429s that look alike:
 *
 *  - **The account's free-request quota is spent** (20/min, 50/day — 1,000/day
 *    once $10 of credits has ever been bought). This applies across *every*
 *    free model on the key, and failed attempts count against it. Trying
 *    another free model here does not help; it burns tomorrow's quota. So
 *    this kind must never trigger a retry or a model switch.
 *
 *  - **One model's provider is throttling** — OpenRouter wraps these as
 *    "Provider returned error" with the provider named in `metadata`. Another
 *    model will answer fine. (In practice OpenRouter's own `models` fallback
 *    handles this in-request; this branch covers the case where every
 *    candidate was exhausted.)
 *
 * Nothing here retries. The only automation downstream is skipping an
 * unavailable model when choosing the *next* turn's default.
 */
import { OpenRouterError } from "./openrouter-client.js";

export type FailureKind =
  | "credits"
  | "free-quota"
  | "model-unavailable"
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

export function classifyFailure(err: unknown): Failure {
  if (err instanceof DOMException && err.name === "AbortError") {
    return { kind: "aborted", message: "Stopped." };
  }

  if (err instanceof OpenRouterError) {
    const said = err.providerMessage || `HTTP ${err.status}`;

    if (err.status === 402) {
      return { kind: "credits", message: said };
    }

    if (err.status === 429) {
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

  if (err instanceof Error) return { kind: "other", message: err.message };
  return { kind: "other", message: String(err) };
}
