import { PieceAuth, Property } from "@powerhousedao/pieces-framework";
import { LlmClient } from "./agent/llm.js";
import { readAuth, type LlmCredentials } from "./common/auth-value.js";
import { KnowledgeVaultClient } from "./common/client.js";
import { KnowledgeVaultApiError } from "./common/errors.js";

const AUTH_DESCRIPTION = `A Switchboard that hosts a knowledge vault, and a bearer for an identity that may use it.

**Switchboard URL** — the origin only, e.g. \`https://vault.example.com\` or \`http://localhost:4001\`: no \`/graphql\`, no \`/api\`.

**Access token** — a Renown bearer. After \`ph login\`, mint one with \`ph access-token --expiry 90d\`. Use a dedicated workflow identity with **WRITE** on the vault drive, not a person's: every write is recorded against this address, and a workflow must never approve its own notes.

**LLM (optional)** — only the model-backed actions (\`Extract claims\`, …) use it. An API key from an OpenAI-compatible provider; the default is OpenRouter (https://openrouter.ai/keys). Give workflows their own key **with a spending limit**: the connection label says when a key has none.

A Switchboard on \`localhost\` or a private network is refused by the workflow runtime unless its address is listed in \`PH_WORKFLOWS_EGRESS_ALLOW_ADDRESSES\` (e.g. \`127.0.0.1/32,::1/128\`).`;

export const knowledgeVaultAuth = PieceAuth.CustomAuth({
  displayName: "Knowledge Vault",
  description: AUTH_DESCRIPTION,
  required: true,
  props: {
    base_url: Property.ShortText({
      displayName: "Switchboard URL",
      required: true,
      description: "e.g. https://vault.example.com — the origin, without /graphql or /api",
    }),
    token: PieceAuth.SecretText({
      displayName: "Access token",
      required: true,
      description: "A Renown bearer: `ph access-token --expiry 90d`",
    }),
    llm_api_key: PieceAuth.SecretText({
      displayName: "LLM API key (optional)",
      required: false,
      description: "For the agent actions only. An OpenRouter key by default (sk-or-…)",
    }),
    llm_base_url: Property.ShortText({
      displayName: "LLM provider URL (optional)",
      required: false,
      description: "An OpenAI-compatible API root. Empty: https://openrouter.ai/api/v1",
    }),
    llm_default_model: Property.ShortText({
      displayName: "Default model (optional)",
      required: false,
      description: "Used when an agent step leaves its model empty, e.g. deepseek/deepseek-v4.1-flash",
    }),
    llm_locality: Property.ShortText({
      displayName: "Where the model runs (optional)",
      required: false,
      description: "local or hosted — set by the desktop app. Empty: decided from the LLM provider URL.",
    }),
  },
  // `auth` here is the flat property value, not the envelope ctx.auth carries.
  validate: async ({ auth }) => {
    try {
      await checkConnection(new KnowledgeVaultClient(readAuth(auth)));
      return { valid: true as const };
    } catch (error) {
      return { valid: false as const, error: describeAuthFailure(error) };
    }
  },
  // Called only after validate passes; best-effort.
  getConnectionIdentifier: async ({ auth }) => {
    const credentials = readAuth(auth);
    const { address, vaults, llm } = await checkConnection(new KnowledgeVaultClient(credentials));
    const expiry = tokenExpiry(credentials.token);
    return [
      `${shortAddress(address)} @ ${new URL(credentials.baseUrl).host}`,
      `${vaults} vault${vaults === 1 ? "" : "s"}`,
      expiry ? `token expires ${expiry}` : undefined,
      llm,
    ]
      .filter(Boolean)
      .join(" · ");
  },
});

export type ConnectionState = { address: string; vaults: number; llm?: string };

/**
 * What must hold before any action can work, checked in the order a failure
 * is easiest to fix: the token is accepted, the Switchboard knows who it is,
 * and that identity can read at least one vault.
 */
export async function checkConnection(client: KnowledgeVaultClient): Promise<ConnectionState> {
  const { user } = await client.ping();
  if (!user) {
    throw new KnowledgeVaultApiError(
      "This Switchboard does not resolve caller identity, so every vault route would refuse the token. It needs caller identity enabled (AUTH_ENABLED).",
      { category: "config" },
    );
  }
  const { drives } = await client.drives();
  if (drives.length === 0) {
    throw new KnowledgeVaultApiError(
      `${user} is signed in but can read no vault on this Switchboard. Ask a vault administrator for WRITE on the drive (gear menu → Access).`,
      { category: "permission" },
    );
  }
  const llm = client.credentials.llm ? await checkLlm(client.credentials.llm) : undefined;
  return { address: user, vaults: drives.length, ...(llm ? { llm } : {}) };
}

/**
 * The LLM half of the check, when the connection carries a key: the key must
 * be accepted, and the label says whether it has a spending limit, because an
 * unattended workflow with an unlimited key is the expensive failure mode.
 * OpenRouter answers `GET /key` for free; any other provider is checked by
 * listing its models.
 */
export async function checkLlm(llm: LlmCredentials, fetchImpl: typeof fetch = fetch): Promise<string> {
  const host = new URL(llm.baseUrl).host;
  const headers = { Authorization: `Bearer ${llm.apiKey}` };
  if (/openrouter\.ai$/i.test(host)) {
    const response = await fetchImpl(`${llm.baseUrl}/key`, { headers, signal: AbortSignal.timeout(20_000) });
    if (response.status === 401 || response.status === 403) {
      throw new KnowledgeVaultApiError("The LLM provider rejected the API key. Create a new one at https://openrouter.ai/keys.", { category: "credential" });
    }
    if (!response.ok) throw new KnowledgeVaultApiError(`The LLM provider answered ${response.status} to the key check`, { category: "server", retryable: true });
    const { data } = (await response.json()) as { data?: { limit?: number | null; limit_remaining?: number | null } };
    const limit = data?.limit;
    return typeof limit === "number" ? `LLM: ${host} (limit $${limit}, $${(data?.limit_remaining ?? 0).toFixed(2)} left)` : `LLM: ${host} (no spending limit)`;
  }
  const models = await new LlmClient(llm, fetchImpl).listModels(true);
  return `LLM: ${host} (${models.length} tool models)`;
}

export function describeAuthFailure(error: unknown): string {
  if (error instanceof KnowledgeVaultApiError) {
    switch (error.category) {
      case "credential":
        // Only a 401 from the Switchboard is about the vault token; the LLM
        // key check and an empty field are credential errors too, with their own words.
        return error.status === 401
          ? "The Switchboard rejected the token: it has expired, was revoked, or was not copied whole. Paste only the token (eyJ…) from `ph access-token --expiry 90d`."
          : error.message;
      case "not_found":
        return "That address answered, but not with a knowledge vault. Check the Switchboard URL, and that the knowledge-note package is installed there.";
      case "network":
      case "timeout":
        return isPrivate(error)
          ? `The Switchboard is unreachable (${text(error.detail) || error.message}). A local or private address must be listed in PH_WORKFLOWS_EGRESS_ALLOW_ADDRESSES on the workflow host.`
          : `The Switchboard is unreachable: ${error.message}`;
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function isPrivate(error: KnowledgeVaultApiError): boolean {
  return /ECONNREFUSED|EHOSTUNREACH|egress|127\.0\.0\.1|localhost|::1|10\.|192\.168\./i.test(
    `${error.message} ${text(error.detail)}`,
  );
}

/** The JWT's `exp` as a date, read without verifying: it only labels the connection. */
export function tokenExpiry(token: string): string | undefined {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp?: unknown;
    };
    return typeof json.exp === "number" ? new Date(json.exp * 1000).toISOString().slice(0, 10) : undefined;
  } catch {
    return undefined;
  }
}

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function shortAddress(address: string): string {
  return /^0x[0-9a-f]{40}$/i.test(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
