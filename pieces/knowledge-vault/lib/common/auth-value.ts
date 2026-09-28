import { KnowledgeVaultApiError } from "./errors.js";

export interface LlmCredentials {
  /** An OpenAI-compatible API root, e.g. https://openrouter.ai/api/v1. */
  baseUrl: string;
  apiKey: string;
  defaultModel?: string;
}

export interface KnowledgeVaultCredentials {
  baseUrl: string;
  token: string;
  /** Present only when the connection carries an LLM key (agent actions). */
  llm?: LlmCredentials;
}

export const DEFAULT_LLM_BASE_URL = "https://openrouter.ai/api/v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Strips a trailing slash and refuses a base URL that already points at the
// API: every request built on one would 404 with no hint why.
export function normalizeBaseUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new KnowledgeVaultApiError("Base URL is required", {
      category: "config",
    });
  }
  const trimmed = raw.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new KnowledgeVaultApiError(
      `"${trimmed}" is not a valid URL — expected something like https://example.com`,
      { category: "config" },
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new KnowledgeVaultApiError(
      trimmed.includes("//")
        ? `Base URL must be http or https, got "${parsed.protocol}"`
        : `Base URL is missing its scheme — use https://${trimmed}`,
      { category: "config" },
    );
  }
  // The two things most likely to be pasted: the GraphQL endpoint and the REST
  // base. Both are one level too deep; the piece builds its own paths.
  if (/\/(graphql|api)(\/.*)?$/i.test(parsed.pathname)) {
    throw new KnowledgeVaultApiError(
      `Use the Switchboard origin only (${parsed.origin}), without /graphql or /api`,
      { category: "config" },
    );
  }
  return trimmed;
}

// `ctx.auth` arrives shaped as { type: "CUSTOM_AUTH", props }, while `validate`
// and `getConnectionIdentifier` are handed the flat props. Take both.
/**
 * What people paste: the bare JWT, or "Bearer eyJ…", with quotes or a
 * trailing newline from the terminal. A newline alone makes the request
 * header invalid, so all of it is removed here.
 */
export function cleanToken(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^["'`]+|["'`]+$/g, "").trim().replace(/^bearer\s+/i, "").trim();
}

/**
 * The connection's props in the order the piece declares them (auth.ts; a
 * test holds the two equal). On 6.2.3-dev.28 the runtime's pieceCatalog
 * serves a package piece's CustomAuth props as a list, and Studio's form
 * walks them with Object.entries, so a connection made in Studio stores
 * base_url as "0", token as "1", and so on. Mapped back here by position.
 */
export const AUTH_PROP_ORDER = ["base_url", "token", "llm_api_key", "llm_base_url", "llm_default_model"] as const;

function byName(props: Record<string, unknown>): Record<string, unknown> {
  if ("base_url" in props || "token" in props || !("0" in props || "1" in props)) return props;
  const named: Record<string, unknown> = { ...props };
  AUTH_PROP_ORDER.forEach((name, i) => {
    if (named[name] === undefined && props[String(i)] !== undefined) named[name] = props[String(i)];
  });
  return named;
}

export function readAuth(auth: unknown): KnowledgeVaultCredentials {
  const raw = isRecord(auth) && isRecord(auth.props) ? auth.props : auth;
  const source = isRecord(raw) ? byName(raw) : raw;
  if (!isRecord(source)) {
    throw new KnowledgeVaultApiError(
      "No Knowledge Vault connection was provided",
      { category: "credential" },
    );
  }
  const token = cleanToken(source.token);
  if (!token) {
    throw new KnowledgeVaultApiError("The connection has no API token", {
      category: "credential",
    });
  }
  const credentials: KnowledgeVaultCredentials = { baseUrl: normalizeBaseUrl(source.base_url), token };
  const apiKey = typeof source.llm_api_key === "string" ? source.llm_api_key.trim() : "";
  if (apiKey) {
    const rawBase = typeof source.llm_base_url === "string" ? source.llm_base_url.trim() : "";
    const model = typeof source.llm_default_model === "string" ? source.llm_default_model.trim() : "";
    credentials.llm = {
      baseUrl: (rawBase || DEFAULT_LLM_BASE_URL).replace(/\/+$/, ""),
      apiKey,
      ...(model ? { defaultModel: model } : {}),
    };
  }
  return credentials;
}
