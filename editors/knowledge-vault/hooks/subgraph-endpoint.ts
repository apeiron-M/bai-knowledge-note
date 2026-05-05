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
 *   4. Vite dev proxy (port 3000/3001 → localhost:4001)
 *   5. Same-origin (Connect production where the subgraph is co-hosted)
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

  const port = globalThis.window?.location?.port;
  if (port === "3000" || port === "3001") {
    return `http://localhost:4001${SUBGRAPH_PATH}`;
  }

  return SUBGRAPH_PATH;
}
