import type { RouteContext } from "@powerhousedao/shared/processors";
import { requireUser } from "../lib/authorize.js";
import type { ConvertRouteDeps } from "../lib/deps.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";

/**
 * `GET convert/progress/:job` — where a conversion started with `?job=` is.
 *
 * The service streams the plain pass and counts pages as they finish; the
 * chunking pass has no page signal and is reported as a phase. A job the
 * service has forgotten (it keeps them a minute after completion) is a 404,
 * so a poller knows to stop rather than read a stale bar.
 */
export function createProgressRoute(deps: ConvertRouteDeps) {
  return async function handleConvertProgress(
    _request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      requireUser(ctx);
      const job = ctx.params.job;
      if (!job)
        throw new HttpError(400, "JOB_REQUIRED", "A job id is required.");
      if (!deps.service)
        throw new HttpError(
          503,
          "CONVERT_NOT_CONFIGURED",
          "No conversion service is configured.",
        );
      const progress = await deps.service.progress(job);
      if (!progress)
        throw new HttpError(
          404,
          "JOB_NOT_FOUND",
          "No such conversion job (finished jobs are kept for a minute).",
        );
      return Response.json(progress, { headers: OK_CACHE });
    } catch (error) {
      return jsonError(error);
    }
  };
}
