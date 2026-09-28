import type { KnowledgeVaultCredentials } from "./auth-value.js";
import { classify, KnowledgeVaultApiError, readErrorBody } from "./errors.js";

export type HttpVerb = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: HttpVerb;
  /** Relative to the vault's REST base, e.g. "search" or "notes/abc". */
  path: string;
  query?: Record<string, QueryValue>;
  json?: unknown;
  timeoutMs?: number;
  /** Send no bearer (the probe that tells "auth required" from "token rejected"). */
  anonymous?: boolean;
  /** Ask for text instead of JSON; the body is returned as a string. */
  accept?: "application/json" | "text/markdown" | "text/plain";
}

/** Where the vault's REST routes live under a Switchboard origin. */
export const VAULT_REST_PREFIX = "api/@powerhousedao/knowledge-note";

const DEFAULT_TIMEOUT_MS = 30_000;

export class KnowledgeVaultClient {
  constructor(
    readonly credentials: KnowledgeVaultCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  url(path: string, query?: Record<string, QueryValue>): URL {
    const url = new URL(
      `${this.credentials.baseUrl}/${VAULT_REST_PREFIX}/${path.replace(/^\/+/, "")}`,
    );
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.append(key, String(value));
    }
    return url;
  }

  async request<T = unknown>(options: RequestOptions): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(options.path, options.query), {
        method: options.method ?? "GET",
        headers: {
          Accept: options.accept ?? "application/json",
          ...(options.anonymous ? {} : { Authorization: `Bearer ${this.credentials.token}` }),
          ...(options.json === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: options.json === undefined ? undefined : JSON.stringify(options.json),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new KnowledgeVaultApiError(
        aborted ? "The request timed out" : `Could not reach the Switchboard: ${describeCause(error)}`,
        { category: aborted ? "timeout" : "network", retryable: true, detail: describeCause(error) },
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    const wantsText = options.accept !== undefined && options.accept !== "application/json";
    const body: unknown = text === "" ? undefined : response.ok && wantsText ? text : safeJson(text);
    if (!response.ok) {
      const { message, code } = readErrorBody(body);
      const { category, retryable } = classify(response.status, code);
      throw new KnowledgeVaultApiError(message ?? `The vault answered ${response.status}`, {
        status: response.status,
        code,
        category,
        retryable,
        detail: body,
      });
    }
    return body as T;
  }

  /** `GET ping`: who the Switchboard thinks the bearer is (`null` if it resolves no identity). */
  ping(anonymous = false): Promise<{ ok: boolean; user: string | null }> {
    return this.request({ path: "ping", anonymous });
  }

  /** `GET drives`: the vault drives this identity may read. */
  drives(): Promise<{ drives: { id: string; name: string; slug: string }[] }> {
    return this.request({ path: "drives" });
  }
}

/** Node's fetch hides the useful part (ECONNREFUSED, ENOTFOUND, the egress refusal) in `cause`. */
export function describeCause(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    return typeof code === "string" ? `${code}: ${cause.message}` : cause.message;
  }
  return error.message;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
