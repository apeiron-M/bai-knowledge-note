import type { RouteContext } from "@powerhousedao/shared/processors";
import { requireUser } from "../lib/authorize.js";
import type { ConvertRouteDeps } from "../lib/deps.js";
import { jsonError, OK_CACHE } from "../lib/respond.js";

/** The body of a health answer for a vault that has no conversion service. */
const unconfiguredHealth = {
  ok: false,
  backend: null,
  ready: false,
  missing: [],
  formats: [],
  configured: false,
};

/** The body of a health answer when the service is configured but unreachable. */
const unreachableHealth = {
  ok: false,
  backend: null,
  ready: false,
  missing: [],
  formats: [],
  configured: true,
};

/**
 * Health answers **200 in every case**, including "not configured" and "the
 * service is down". A probe reading health is asking what the state is, and a
 * 503 here would report a working vault as broken — the vault works fine
 * without conversion, only the new capability is absent. `configured` says
 * whether a service was configured at all; `ok` says whether it answered.
 */
export function createHealthRoute(deps: ConvertRouteDeps) {
  return async function handleConvertHealth(
    _request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      requireUser(ctx);
      if (!deps.service) {
        return Response.json(unconfiguredHealth, { headers: OK_CACHE });
      }
      try {
        const health = await deps.service.health();
        return Response.json({ ...health, configured: true }, { headers: OK_CACHE });
      } catch {
        // Configured but unreachable is a *state*, not a failed request.
        return Response.json(unreachableHealth, { headers: OK_CACHE });
      }
    } catch (error) {
      return jsonError(error);
    }
  };
}