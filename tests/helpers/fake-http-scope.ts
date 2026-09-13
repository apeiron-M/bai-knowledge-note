import type {
  IHttpScope,
  RouteContext,
  RouteHandler,
  RouteOptions,
  RouteSpec,
  ScopedRouteHandle,
} from "@powerhousedao/shared/processors";

export interface RecordedRoute {
  method: string;
  path: string;
  handler: RouteHandler;
  options?: RouteOptions;
}

export interface FakeHttpScope {
  scope: IHttpScope;
  routes: RecordedRoute[];
  invoke(
    method: string,
    path: string,
    request: Request,
    ctx: RouteContext,
  ): Promise<Response>;
}

export function createFakeHttpScope(): FakeHttpScope {
  const routes: RecordedRoute[] = [];
  const handle = (): ScopedRouteHandle =>
    ({ dispose: () => {} }) as unknown as ScopedRouteHandle;
  const register =
    (method: string) =>
    (
      path: string,
      a: RouteOptions | RouteHandler,
      b?: RouteHandler,
    ): ScopedRouteHandle => {
      const handler = (typeof a === "function" ? a : b) as RouteHandler;
      routes.push({
        method,
        path,
        handler,
        options: typeof a === "function" ? undefined : a,
      });
      return handle();
    };
  const scope = {
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
    patch: register("PATCH"),
    delete: register("DELETE"),
    head: register("HEAD"),
    route: (spec: RouteSpec) => {
      for (const method of spec.method) {
        routes.push({
          method,
          path: spec.path,
          handler: spec.handler,
          options: spec,
        });
      }
      return handle();
    },
    nodeRoute: () => {
      throw new Error("nodeRoute is not faked");
    },
    webhooks: {
      register: () => {
        throw new Error("webhooks are not faked");
      },
    },
    dispose: () => {},
  } as unknown as IHttpScope;
  return {
    scope,
    routes,
    invoke: async (method, path, request, ctx) => {
      const route = routes.find((r) => r.method === method && r.path === path);
      if (!route) throw new Error(`no route ${method} ${path}`);
      return route.handler(request, ctx);
    },
  };
}