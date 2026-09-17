import type { IHttpScope } from "@powerhousedao/shared/processors";
import { describe, expect, it } from "vitest";
import type { ConversionService } from "./lib/service.js";
import { getResolvers, registerConvertRoutes } from "./resolvers.js";
import type { ConvertSubgraph } from "./index.js";

interface Registered {
  method: string;
  path: string;
  options: { auth?: string; body?: string; maxBodyBytes?: number } | undefined;
}

/** A minimal stand-in for the subgraph's `http` scope. */
const fakeHttp = () => {
  const routes: Registered[] = [];
  const record =
    (method: string) =>
    (
      path: string,
      options?: Registered["options"],
      _handler?: unknown,
    ): void => {
      routes.push({ method, path, options });
    };
  const scope = { get: record("GET"), post: record("POST") } as unknown as IHttpScope;
  return { routes, scope };
};

const stubService = (over: Partial<ConversionService> = {}): ConversionService => ({
  convert: async () => ({ markdown: "", chunks: [] }),
  health: async () => ({
    ok: true,
    backend: "docling.rs",
    ready: true,
    missing: [],
    formats: ["md", "pdf"],
  }),
  ...over,
});

/** The subgraph surface the resolvers actually touch. */
const fakeSubgraph = (deps: { service?: ConversionService }): ConvertSubgraph =>
  ({ routeDeps: deps }) as unknown as ConvertSubgraph;

describe("registerConvertRoutes", () => {
  it("registers health as a GET and convert as a raw-body POST", () => {
    const { routes, scope } = fakeHttp();
    registerConvertRoutes(scope, { service: stubService() });

    const health = routes.find((r) => r.path === "convert/health");
    const convert = routes.find((r) => r.path === "convert");

    expect(health?.method).toBe("GET");
    expect(health?.options?.auth).toBe("renown");
    expect(convert?.method).toBe("POST");
    expect(convert?.options?.auth).toBe("renown");
    // A document body, not JSON: the service detects the format from the bytes.
    expect(convert?.options?.body).toBe("raw");
    expect(convert?.options?.maxBodyBytes).toBe(30 * 1024 * 1024);
  });

  it("is idempotent per scope, because onSetup runs again on a reload", () => {
    // The framework replaces subgraph instances in place and re-runs onSetup.
    // The http scope throws on a duplicate path — which crashed the whole
    // Switchboard when this registered unconditionally.
    const { routes, scope } = fakeHttp();
    registerConvertRoutes(scope, { service: stubService() });
    expect(() => registerConvertRoutes(scope, { service: stubService() })).not.toThrow();
    expect(routes).toHaveLength(2);
  });

  it("registers on a fresh scope, so a real reload still gets its routes", () => {
    const first = fakeHttp();
    const second = fakeHttp();
    registerConvertRoutes(first.scope, { service: stubService() });
    registerConvertRoutes(second.scope, { service: stubService() });
    expect(first.routes).toHaveLength(2);
    expect(second.routes).toHaveLength(2);
  });

  it("does not crash when the scope reports the route as already registered", () => {
    // The belt-and-braces branch: a new scope object backed by the same
    // registration map. Crashing the server over it is the wrong trade.
    const routes: Registered[] = [];
    const scope = {
      get: () => {
        throw new Error('Route GET /api/…/convert/health is already registered by "x"');
      },
      post: () => {
        throw new Error("should not be reached");
      },
    } as unknown as IHttpScope;
    expect(() => registerConvertRoutes(scope, { service: stubService() })).not.toThrow();
    expect(routes).toHaveLength(0);
  });

  it("still re-throws a genuine registration failure", () => {
    const scope = {
      get: () => {
        throw new Error("something else entirely");
      },
      post: () => {},
    } as unknown as IHttpScope;
    expect(() => registerConvertRoutes(scope, { service: stubService() })).toThrow(
      /something else entirely/,
    );
  });
});

describe("getResolvers", () => {
  it("exposes the health through the generated namespace", async () => {
    const resolvers = getResolvers(fakeSubgraph({ service: stubService() }));
    const queries = resolvers.ConvertQueries;
    const health = await queries.health();
    expect(health).toMatchObject({ ok: true, configured: true, ready: true });
  });

  it("returns an object for the namespace field, so children can resolve", () => {
    const resolvers = getResolvers(fakeSubgraph({}));
    expect(resolvers.Query.convert()).toEqual({});
  });

  it("reports configured: false when there is no service", async () => {
    const resolvers = getResolvers(fakeSubgraph({}));
    const health = await resolvers.ConvertQueries.health();
    expect(health).toMatchObject({ ok: false, configured: false, ready: false });
  });

  it("reports configured but not ok when the service is unreachable", async () => {
    const resolvers = getResolvers(
      fakeSubgraph({
        service: stubService({
          health: async () => {
            throw new Error("ECONNREFUSED");
          },
        }),
      }),
    );
    const health = await resolvers.ConvertQueries.health();
    expect(health).toMatchObject({ ok: false, configured: true });
  });
});
