/**
 * Resolve the URL of the package's `knowledgeGraph` subgraph for the
 * current Connect host. Used by `useGraphSearch` and `ActivityView`, both
 * of which talk directly to the switchboard via plain fetch (no apollo
 * client wrapping).
 *
 * Priority:
 *   1. `VITE_SUBGRAPH_URL` env override (escape hatch for unusual deploys)
 *   2. Explicit Connect → Switchboard mappings (`DOMAIN_MAP`)
 *   3. Vetra host patterns (see `resolveSwitchboardOrigin` for all three)
 *   4. Any localhost / 127.0.0.1 → http://localhost:4001
 *      (covers `ph vetra` direct on 3001 AND Cursor/VS Code remote-dev
 *      port-forwarding which proxies Connect to a random localhost port
 *      like 26045 — the IDE typically auto-forwards 4001 too).
 *   5. Same-origin (production where the subgraph is co-hosted)
 */

const SUBGRAPH_PATH = "/graphql/knowledgeGraph";

const DOMAIN_MAP: Record<string, string> = {
  "connect-dev.powerhouse.xyz": "https://switchboard-dev.powerhouse.xyz",
};

/**
 * Map a Connect hostname to its Switchboard origin, or `null` when the two are
 * co-hosted (same origin) and a relative path should be used instead.
 *
 * Vetra Cloud issues hostnames in three shapes and all must be handled:
 *   - `connect.<slug>.vetra.io`  → `switchboard.<slug>.vetra.io`  (subdomain)
 *   - `<slug>-connect.vetra.io`  → `<slug>-switchboard.vetra.io`  (suffix)
 *   - `<slug>.vetra.io`          → `switchboard.<slug>.vetra.io`  (bare slug)
 *
 * The suffix form is what per-environment cloud deployments actually use
 * (e.g. `rare-emu-780314b9-connect.vetra.io`). It does NOT match the subdomain
 * pattern, so before this existed such hosts silently fell through to
 * same-origin and every subgraph call hit Connect instead of Switchboard.
 *
 * The bare-slug form is what a named Vetra domain produces: Connect at
 * `knowledge-vault.vetra.io`, Switchboard at `switchboard.knowledge-vault.vetra.io`.
 * It failed the same way until it was added — same-origin, so every call hit
 * Connect. A miss here is never loud: `null` is also the legitimate answer for a
 * co-hosted deployment, so an unrecognised host looks like a working one until
 * the first request comes back as Connect's HTML.
 */
export function resolveSwitchboardOrigin(): string | null {
  const hostname = globalThis.window?.location?.hostname;
  if (!hostname) return null;

  if (DOMAIN_MAP[hostname]) return DOMAIN_MAP[hostname];

  // `ph vetra` serves Switchboard on 4001 whatever port Connect is on. Also
  // covers IDE remote-dev tunnels that forward Connect to a random port.
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:4001";
  }

  if (/^connect\..+\.vetra\.io$/.test(hostname)) {
    return `https://${hostname.replace(/^connect\./, "switchboard.")}`;
  }

  if (/^.+-connect\.vetra\.io$/.test(hostname)) {
    return `https://${hostname.replace(/-connect\.vetra\.io$/, "-switchboard.vetra.io")}`;
  }

  // Bare slug. Must stay after the suffix rule: `<slug>-connect.vetra.io` is a
  // single label too, and would otherwise map to `switchboard.<slug>-connect…`.
  // A host that is itself a Switchboard is left alone — same-origin is right there.
  const bare = /^([a-z0-9-]+)\.vetra\.io$/i.exec(hostname);
  if (bare && !/(^|-)switchboard$/i.test(bare[1])) {
    return `https://switchboard.${hostname}`;
  }

  return null;
}

/** Switchboard's `/graphql` endpoint for the current host. */
export function resolveReactorEndpoint(): string {
  const origin = resolveSwitchboardOrigin();
  return origin ? `${origin}/graphql` : "/graphql";
}

/**
 * Switchboard's core `auth` subgraph, which serves the host's document
 * permission tables. It is registered only when `DOCUMENT_PERMISSIONS_ENABLED`
 * is true, so every query against it must tolerate the whole endpoint being
 * absent on a deployment that has authorization switched off.
 */
export function resolveAuthEndpoint(): string {
  const origin = resolveSwitchboardOrigin();
  return origin ? `${origin}/graphql/auth` : "/graphql/auth";
}

export function resolveKnowledgeGraphEndpoint(): string {
  const envUrl =
    typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_SUBGRAPH_URL;
  if (envUrl) return envUrl;

  const origin = resolveSwitchboardOrigin();
  return origin ? `${origin}${SUBGRAPH_PATH}` : SUBGRAPH_PATH;
}
