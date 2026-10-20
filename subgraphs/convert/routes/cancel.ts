import type { RouteContext } from "@powerhousedao/shared/processors";
import { requireUser } from "../lib/authorize.js";
import type { ConvertRouteDeps } from "../lib/deps.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";
import { notConfigured } from "./convert.js";

/** The service's own rule for a job id; anything else never reaches it. */
const JOB_ID = /^[\w-]{1,80}$/;

/**
 * `DELETE convert/:job` — stop a conversion started with `?job=`.
 *
 * Cancellation is an explicit call because the convert route cannot follow
 * its caller hanging up (routes/convert.ts says why). A client that no longer
 * wants a file says so here; the service stops the worker and frees the
 * file's lane at once, so the next file does not wait behind a conversion
 * nobody will read.
 *
 * `200 { cancelled: true }` when the job was running; `404 { cancelled: false }`
 * when it was not — already finished, or never started — which a client treats
 * as done, not as a failure.
 */
export function createCancelRoute(deps: ConvertRouteDeps) {
  return async function handleConvertCancel(
    _request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      requireUser(ctx);
      // Widened to possibly absent: `RegExp.test(undefined)` tests the string
      // "undefined", which the rule would accept.
      const job = ctx.params.job as string | undefined;
      if (job === undefined || !JOB_ID.test(job)) {
        throw new HttpError(
          400,
          "INVALID_JOB",
          "A job id is 1 to 80 letters, digits, underscores or hyphens.",
        );
      }
      if (!deps.service) throw notConfigured();
      const cancelled = await deps.service.cancel(job);
      return Response.json(
        { cancelled },
        { status: cancelled ? 200 : 404, headers: OK_CACHE },
      );
    } catch (error) {
      return jsonError(error);
    }
  };
}
