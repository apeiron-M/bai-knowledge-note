import type { RouteContext } from "@powerhousedao/shared/processors";
import { requireUser } from "../lib/authorize.js";
import type { ConvertRouteDeps } from "../lib/deps.js";
import { ownerOf, sharedKeptResults } from "../lib/kept.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";

/**
 * `GET convert/result/:job` — the answer to a conversion started with `?job=`,
 * for a page that could not wait for it: reloaded, or its window restarted,
 * while the file converted (lib/kept.ts). Only the user who started the job
 * gets it.
 *
 * - 200 and the convert route's own body: it finished;
 * - 200 `{ failed: { status, code, error } }`: it failed, and how;
 * - 202 `{ running: true }`: still converting — ask again;
 * - 404 `RESULT_NOT_FOUND`: no answer is kept (not started here, ended more
 *   than half an hour ago, or the engine restarted) — convert it again.
 */
export function createResultRoute(deps: ConvertRouteDeps) {
  const kept = deps.kept ?? sharedKeptResults();
  return async function handleConvertResult(
    _request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      const user = requireUser(ctx);
      const job = ctx.params.job;
      if (!job)
        throw new HttpError(400, "JOB_REQUIRED", "A job id is required.");
      const answer = await kept.read(job, ownerOf(user));
      if (!answer)
        throw new HttpError(
          404,
          "RESULT_NOT_FOUND",
          "No answer is kept for this conversion: it did not start here, or it ended more than half an hour ago.",
        );
      if (answer.kind === "running")
        return Response.json(
          { running: true },
          { status: 202, headers: OK_CACHE },
        );
      if (answer.kind === "failed") {
        let failure: { code?: string; error?: string } = {};
        try {
          failure = JSON.parse(answer.body) as typeof failure;
        } catch {
          // A body that is not JSON: the status still says it failed.
        }
        return Response.json(
          {
            failed: {
              status: answer.status,
              code: failure.code ?? "CONVERT_FAILED",
              error: failure.error ?? "The conversion failed.",
            },
          },
          { headers: OK_CACHE },
        );
      }
      return new Response(answer.body, {
        headers: { "content-type": "application/json", ...OK_CACHE },
      });
    } catch (error) {
      return jsonError(error);
    }
  };
}
