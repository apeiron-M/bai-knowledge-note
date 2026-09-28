import { PieceAuth, Property } from "@powerhousedao/pieces-framework";
import { readAuth } from "./common/auth-value.js";
import { KnowledgeVaultClient } from "./common/client.js";
import { KnowledgeVaultApiError } from "./common/errors.js";

const AUTH_DESCRIPTION = `A Switchboard that hosts a knowledge vault, and a bearer for an identity that may use it.

**Switchboard URL** — the origin only, e.g. \`https://vault.example.com\` or \`http://localhost:4001\`: no \`/graphql\`, no \`/api\`.

**Access token** — a Renown bearer. After \`ph login\`, mint one with \`ph access-token --expiry 90d\`. Use a dedicated workflow identity with **WRITE** on the vault drive, not a person's: every write is recorded against this address, and a workflow must never approve its own notes.

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
    const { address, vaults } = await checkConnection(new KnowledgeVaultClient(credentials));
    const expiry = tokenExpiry(credentials.token);
    return [
      `${shortAddress(address)} @ ${new URL(credentials.baseUrl).host}`,
      `${vaults} vault${vaults === 1 ? "" : "s"}`,
      expiry ? `token expires ${expiry}` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
  },
});

export type ConnectionState = { address: string; vaults: number };

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
  return { address: user, vaults: drives.length };
}

export function describeAuthFailure(error: unknown): string {
  if (error instanceof KnowledgeVaultApiError) {
    switch (error.category) {
      case "credential":
        return "The Switchboard rejected the token: it has expired or was revoked. Mint a new one with `ph access-token`.";
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
