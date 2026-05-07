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
  "connect-dev.powerhouse.xyz":
    "https://switchboard-dev.powerhouse.xyz/graphql/knowledgeGraph",
};

export function resolveKnowledgeGraphEndpoint(): string {
  const envUrl =
    typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_SUBGRAPH_URL;
  if (envUrl) return envUrl;

  const hostname = globalThis.window?.location?.hostname;
  if (hostname && DOMAIN_MAP[hostname]) {
    return DOMAIN_MAP[hostname];
  }

  if (hostname && /^connect\..+\.vetra\.io$/.test(hostname)) {
    const sbHost = hostname.replace(/^connect\./, "switchboard.");
    return `https://${sbHost}${SUBGRAPH_PATH}`;
  }

  // Any localhost / loopback hostname → use the conventional `ph vetra`
  // switchboard port (4001), regardless of which port Connect itself is
  // served on. This covers IDE remote-dev tunnels (Cursor, VS Code
  // Remote, etc.) where Connect ends up on a random forwarded port.
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `http://localhost:4001${SUBGRAPH_PATH}`;
  }

  return SUBGRAPH_PATH;
}
