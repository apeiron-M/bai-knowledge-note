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
export function readAuth(auth: unknown): KnowledgeVaultCredentials {
  const source = isRecord(auth) && isRecord(auth.props) ? auth.props : auth;
  if (!isRecord(source)) {
    throw new KnowledgeVaultApiError(
      "No Knowledge Vault connection was provided",
      { category: "credential" },
    );
  }
  const token = source.token;
  if (typeof token !== "string" || token === "") {
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
