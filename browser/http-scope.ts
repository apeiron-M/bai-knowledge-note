/**
 * An HTTP scope served inside the page. The package registers its REST routes
 * on a scope (subgraphs/http/register.ts, subgraphs/convert/resolvers.ts); on
 * the Switchboard that is reactor-api's, here it is this one, and requests the
 * vault sends to its in-page origin are dispatched to the same handlers.
 */
import type {
  IHttpScope,
  RouteContext,
  RouteHandler,
  RouteOptions,
  RouteSpec,
  RouteUser,
  ScopedRouteHandle,
} from "@powerhousedao/shared/processors";

type Route = {
  methods: ReadonlySet<string>;
  pattern: RegExp;
  keys: string[];
  options: RouteOptions;
  handler: RouteHandler;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `notes/:id.md` → /^notes\/([^/]+?)\.md$/ with keys ["id"]. */
function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) =>
      segment.replace(/:([A-Za-z_]\w*)|([^:]+)/g, (_, key: string | undefined, literal: string | undefined) => {
        if (key) {
          keys.push(key);
          return "([^/]+?)";
        }
        return escape(literal ?? "");
      }),
    )
    .join("/");
  return { pattern: new RegExp(`^${source}$`), keys };
}

export type PageHttpScope = {
  scope: IHttpScope;
  /** Answer `request` for `path` (relative to the scope), or null when no route matches. */
  handle(request: Request, path: string, user: RouteUser): Promise<Response | null>;
};

export function createPageHttpScope(baseUrl: string): PageHttpScope {
  const routes: Route[] = [];
  const add = (method: string | string[], path: string, options: RouteOptions, handler: RouteHandler): ScopedRouteHandle => {
    const route: Route = {
      methods: new Set((Array.isArray(method) ? method : [method]).map((m) => m.toUpperCase())),
      ...compile(path),
      options,
      handler,
    };
    routes.push(route);
    return {
      url: `${baseUrl}/${path.replace(/^\/+/, "")}`,
      dispose: () => {
        const at = routes.indexOf(route);
        if (at >= 0) routes.splice(at, 1);
      },
    };
  };
  const verb =
    (method: string) =>
    (path: string, optionsOrHandler: RouteOptions | RouteHandler, maybeHandler?: RouteHandler) =>
      typeof optionsOrHandler === "function"
        ? add(method, path, {}, optionsOrHandler)
        : add(method, path, optionsOrHandler, maybeHandler as RouteHandler);

  const scope = {
    owner: "browser-vault",
    baseUrl,
    get: verb("GET"),
    post: verb("POST"),
    put: verb("PUT"),
    patch: verb("PATCH"),
    delete: verb("DELETE"),
    head: verb("HEAD"),
    route: (spec: RouteSpec) => add(spec.method, spec.path, spec, spec.handler),
  } as unknown as IHttpScope;

  return {
    scope,
    async handle(request, path, user) {
      const method = request.method.toUpperCase();
      for (const route of routes) {
        if (!route.methods.has(method)) continue;
        const match = route.pattern.exec(path);
        if (!match) continue;
        const params: Record<string, string> = {};
        route.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(match[i + 1] ?? "");
        });
        const url = new URL(request.url);
        const ctx: RouteContext = {
          params,
          user,
          authEnabled: false,
          // The convert route reads the upload from here; a Uint8Array is what it needs of a Buffer.
          rawBody:
            route.options.body === "raw"
              ? (new Uint8Array(await request.clone().arrayBuffer()) as unknown as RouteContext["rawBody"])
              : undefined,
          signal: request.signal,
          transport: { proto: url.protocol.replace(/:$/, ""), host: url.host, prefix: "", baseUrl },
        };
        return route.handler(request, ctx);
      }
      return null;
    },
  };
}
