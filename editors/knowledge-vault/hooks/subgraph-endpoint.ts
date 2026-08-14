/**
 * Resolve the URL of the package's `knowledgeGraph` subgraph for the
 * current Connect host. Used by `useGraphSearch` and `ActivityView`, both
 * of which talk directly to the switchboard via plain fetch (no apollo
 * client wrapping).
 *
 * Priority:
 *   1. `VITE_SUBGRAPH_URL` env override (escape hatch for unusual deploys)
 *   2. Explicit Connect → Switchboard mappings (`DOMAIN_MAP`)
 *   3. Vetra subdomain pattern: connect.<slug>.vetra.io ↔ switchboard.<slug>.vetra.io
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
 * Vetra Cloud issues hostnames in two shapes and both must be handled:
 *   - `connect.<slug>.vetra.io`  → `switchboard.<slug>.vetra.io`  (subdomain)
 *   - `<slug>-connect.vetra.io`  → `<slug>-switchboard.vetra.io`  (suffix)
 *
 * The suffix form is what per-environment cloud deployments actually use
 * (e.g. `rare-emu-780314b9-connect.vetra.io`). It does NOT match the subdomain
 * pattern, so before this existed such hosts silently fell through to
 * same-origin and every subgraph call hit Connect instead of Switchboard.
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

  return null;
}

/** Switchboard's `/graphql` endpoint for the current host. */
export function resolveReactorEndpoint(): string {
  const origin = resolveSwitchboardOrigin();
  return origin ? `${origin}/graphql` : "/graphql";
}

export function resolveKnowledgeGraphEndpoint(): string {
  const envUrl =
    typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_SUBGRAPH_URL;
  if (envUrl) return envUrl;

  const origin = resolveSwitchboardOrigin();
  return origin ? `${origin}${SUBGRAPH_PATH}` : SUBGRAPH_PATH;
}
