/**
 * The Switchboard the vault app talks to, answered inside the page.
 *
 * Every endpoint the vault uses derives from the declared host's
 * `switchboardOrigin` (editors/shared/subgraph-endpoint.ts). The browser host
 * declares an origin that cannot resolve (`.invalid`) and wraps `fetch` so that
 * requests to it are answered here, by the in-page engine; every other request
 * passes through untouched. If the wrapper were ever bypassed, the request
 * fails instead of reaching a real server.
 */
import type { ExecutionResult } from "graphql";
import type { GraphQLBody } from "./graphql-runtime.js";

export const LOCAL_ORIGIN = "https://knowledge-vault.invalid";

const REST_PREFIX = "/api/@powerhousedao/knowledge-note/";

export type LocalOriginServices = {
  knowledgeGraph: (body: GraphQLBody) => Promise<ExecutionResult>;
  core: (body: GraphQLBody) => Promise<ExecutionResult>;
  /** The package's REST routes; `path` is relative to `/api/@powerhousedao/knowledge-note/`. */
  rest: (request: Request, path: string) => Promise<Response>;
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function graphqlResponse(
  request: Request,
  run: (body: GraphQLBody) => Promise<ExecutionResult>,
): Promise<Response> {
  let body: GraphQLBody;
  try {
    body = (await request.json()) as GraphQLBody;
  } catch {
    return json(400, { errors: [{ message: "The request body is not JSON." }] });
  }
  const result = await run(body);
  if (result.errors?.length) {
    // The vault asked for something the page does not serve, or a resolver failed: say which.
    const operation = typeof body.query === "string" ? body.query.replace(/\s+/g, " ").slice(0, 120) : "";
    console.warn(
      `[BrowserVault] ${new URL(request.url).pathname}: ${result.errors.map((e) => e.message).join("; ")} — ${operation}`,
    );
  }
  return json(200, result);
}

async function route(request: Request, services: LocalOriginServices): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/graphql/knowledgeGraph") return graphqlResponse(request, services.knowledgeGraph);
  if (pathname === "/graphql" || pathname === "/graphql/r") return graphqlResponse(request, services.core);
  if (pathname.startsWith(REST_PREFIX)) {
    return services.rest(request, pathname.slice(REST_PREFIX.length));
  }
  // Access control, attachments, MCP: nothing to serve for a vault that has one owner and no server.
  return json(404, { error: `${pathname} is not available in the browser vault.`, code: "BROWSER_UNAVAILABLE" });
}

/** Answer `origin` in the page. Returns the uninstaller. */
export function installLocalOrigin(origin: string, services: LocalOriginServices): () => void {
  const passThrough = globalThis.fetch.bind(globalThis);
  const wrapped: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== origin && !url.startsWith(`${origin}/`)) return passThrough(input, init);
    try {
      return await route(new Request(input, init), services);
    } catch (error) {
      console.error("[BrowserVault] A request to the in-page vault failed:", error);
      return json(500, { error: error instanceof Error ? error.message : String(error) });
    }
  };
  globalThis.fetch = wrapped;
  return () => {
    if (globalThis.fetch === wrapped) globalThis.fetch = passThrough;
  };
}
