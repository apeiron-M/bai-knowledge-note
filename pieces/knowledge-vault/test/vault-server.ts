/**
 * A node HTTP server that mounts the vault's REAL route handlers
 * (subgraphs/http/routes) over fake reactor dependencies, at the path a
 * Switchboard serves them on. The piece is tested against the vault's actual
 * request handling -- parameter parsing, auth checks, error envelopes -- so a
 * change to a route that breaks the piece fails here, not in production.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { HttpRouteDeps } from "../../../subgraphs/http/lib/deps.js";
import { createDrivesRoute } from "../../../subgraphs/http/routes/drives.js";
import { createSearchRoute, type SearchRouteDeps } from "../../../subgraphs/http/routes/search.js";

export const GOOD_TOKEN = "good-token";
export const ADDRESS = "0xadba7c2f82139031d7564d18ac22d09b12a0bca4";
export const DRIVE = { id: "drive-1", name: "My Personal Vault", slug: "my-personal-vault" };
const PREFIX = "/api/@powerhousedao/knowledge-note/";

export type VaultServerOptions = {
  /** `false`: the host resolves no caller identity (ping answers user: null). */
  identity?: boolean;
  /** The vault drives the identity may read. */
  drives?: (typeof DRIVE)[];
  hits?: { node: Record<string, unknown>; similarity: number }[];
};

export type VaultServer = {
  baseUrl: string;
  requests: { path: string; query: Record<string, string>; accept: string | null }[];
  close(): Promise<void>;
};

export async function startVaultServer(options: VaultServerOptions = {}): Promise<VaultServer> {
  const identity = options.identity ?? true;
  const drives = options.drives ?? [DRIVE];
  const requests: VaultServer["requests"] = [];

  const deps: HttpRouteDeps = {
    reactorClient: createFakeReactorClient({
      find: (async () => ({
        results: drives.map((d) => ({
          header: { id: d.id, name: d.name, slug: d.slug, meta: { preferredEditor: "knowledge-vault" } },
          state: { global: { nodes: [] } },
        })),
      })) as never,
    }),
    resolveCanonicalDocumentId: (async (id: string) => id) as never,
    authorization: {
      canRead: async () => true,
      canWrite: async () => true,
      canMutate: async () => true,
      isSupremeAdmin: () => false,
    } as never,
    now: () => new Date("2026-09-28T12:00:00Z"),
    uuid: () => "uuid",
  };
  const searchDeps: SearchRouteDeps = {
    ...deps,
    search: async () =>
      (options.hits ?? [
        { node: { documentId: "n1", title: "Sync works by channels", description: "How", status: "CANONICAL", noteType: "concept", content: "body" }, similarity: 0.91 },
        { node: { documentId: "m1", title: "Sync MoC", status: "MOC", noteType: "MOC (TOPIC)" }, similarity: 0.84 },
        { node: { documentId: "n2", title: "Weak match" }, similarity: 0.31 },
      ]).map((h) => ({ ...h, score: h.similarity, matchedBy: ["semantic"] })) as never,
    neighbourhood: async () => ({ related: [], byHit: {}, linksByHit: {}, links: [], totalRelated: 0, truncated: false }) as never,
  };
  const routes: Record<string, (request: Request, ctx: RouteContext) => Promise<Response> | Response> = {
    ping: (_r, ctx) => Response.json({ ok: true, subgraph: "http", user: ctx.user?.address ?? null }),
    drives: createDrivesRoute(deps),
    search: createSearchRoute(searchDeps),
  };

  const server: Server = createServer(async (req: IncomingMessage, res) => {
    const url = new URL(req.url ?? "/", "http://vault.test");
    if (!url.pathname.startsWith(PREFIX)) {
      res.writeHead(404).end("not a vault");
      return;
    }
    const path = url.pathname.slice(PREFIX.length);
    requests.push({ path, query: Object.fromEntries(url.searchParams), accept: req.headers.accept ?? null });
    // What REQUIRE_AUTHENTICATED_CALLER does in front of every route.
    const bearer = req.headers.authorization?.replace(/^Bearer /, "");
    if (bearer !== GOOD_TOKEN) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: bearer ? "Credentials no longer valid" : "Authentication required" }));
      return;
    }
    const handler = routes[path];
    if (!handler) {
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "no route", code: "NOT_FOUND" }));
      return;
    }
    const ctx = {
      user: identity ? { address: ADDRESS, chainId: 1, networkId: "eip155", appKey: "did:key:z" } : undefined,
      params: {},
      authEnabled: identity,
      transport: { proto: "http", host: "vault.test", prefix: "", baseUrl: "http://vault.test" },
    } as unknown as RouteContext;
    const response = await handler(new Request(url, { headers: req.headers as HeadersInit }), ctx);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
