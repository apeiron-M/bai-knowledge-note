import type { IHttpScope } from "@powerhousedao/shared/processors";
import type { ConvertSubgraph } from "./index.js";
import { createConvertRoute, MAX_UPLOAD_BYTES } from "./routes/convert.js";
import { createHealthRoute } from "./routes/health.js";
import { createProgressRoute } from "./routes/progress.js";
import type { ConvertRouteDeps } from "./lib/deps.js";

/**
 * Scopes this process has already registered on.
 *
 * `onSetup` is **not** once-per-process: the framework replaces subgraph
 * instances in place and runs setup again (visible in the log as
 * `[graphql-manager] Replaced /graphql/<name> subgraph`). The http scope keeps
 * one registration map per package and *throws* on a duplicate path —
 * `Route GET .../convert/health is already registered by "@powerhousedao/…"`
 * — which does not fail the subgraph, it fails the Switchboard. Measured: an
 * unconditional register here took the whole server down on reload.
 *
 * So registration is once per scope. Keyed on the scope object rather than a
 * module-level flag, so a genuinely fresh scope still gets its routes, while a
 * reloaded subgraph reusing its scope does not re-register.
 */
const registeredScopes = new WeakSet<IHttpScope>();

/** Registers the package-namespaced routes. Exported for its own test. */
export function registerConvertRoutes(
  http: IHttpScope,
  deps: ConvertRouteDeps,
): void {
  if (registeredScopes.has(http)) return;
  registeredScopes.add(http);

  // Registered in this order because routes match in registration order across
  // the package's single namespace; neither path can shadow the other.
  try {
    http.get("convert/health", { auth: "renown" }, createHealthRoute(deps));
    http.get(
      "convert/progress/:job",
      { auth: "renown" },
      createProgressRoute(deps),
    );
    http.post(
      "convert",
      { auth: "renown", body: "raw", maxBodyBytes: MAX_UPLOAD_BYTES },
      createConvertRoute(deps),
    );
  } catch (error) {
    // Last-resort guard: if a reload handed us a new scope object backed by the
    // same registration map, the first route throws "already registered". That
    // is the reload case, not a mistake in the paths above — and crashing the
    // Switchboard over it is the wrong trade. Anything else re-throws.
    if (!/already registered/i.test(String(error))) throw error;
  }
}

/**
 * The GraphQL surface. `Query.convert` is the namespace resolver the generator
 * established, and it must return an object (even an empty one) for its
 * children to resolve.
 */
export function getResolvers(subgraph: ConvertSubgraph) {
  return {
    Query: {
      convert: () => ({}),
    },
    ConvertQueries: {
      health: async () => {
        const { service } = subgraph.routeDeps;
        if (!service) {
          return {
            ok: false,
            backend: null,
            ready: false,
            missing: [],
            formats: [],
            configured: false,
          };
        }
        try {
          const health = await service.health();
          return { ...health, configured: true };
        } catch {
          // Configured but unreachable: the same distinction the HTTP route
          // makes — the deployment is wrong, the vault is not.
          return {
            ok: false,
            backend: null,
            ready: false,
            missing: [],
            formats: [],
            configured: true,
          };
        }
      },
    },
  };
}
