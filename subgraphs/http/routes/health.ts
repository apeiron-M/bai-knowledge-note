import type { RouteContext } from "@powerhousedao/shared/processors";
import { canonicalForRead } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { badgeSvg, overallStatusOf } from "../lib/health.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";

async function findHealthReport(deps: HttpRouteDeps, drive: string) {
  const found = await deps.reactorClient.find({
    type: "bai/health-report",
    parentId: drive,
  });
  return found.results[0];
}

export function createHealthRoute(deps: HttpRouteDeps) {
  return async function handleHealth(
    request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      const url = new URL(request.url);
      const drive = url.searchParams.get("drive");
      if (!drive) throw new HttpError(400, "BAD_REQUEST", "drive is required");
      const report = await findHealthReport(deps, drive);
      if (!report) {
        throw new HttpError(404, "NOT_FOUND", "No health report in this drive");
      }
      await canonicalForRead(deps, report.header.id, ctx);
      const state = report.state as { global?: unknown } | undefined;
      return Response.json(state?.global ?? {}, { headers: OK_CACHE });
    } catch (error) {
      return jsonError(error);
    }
  };
}

export function createBadgeRoute(deps: HttpRouteDeps) {
  return async function handleBadge(
    request: Request,
    _ctx: RouteContext,
  ): Promise<Response> {
    try {
      const url = new URL(request.url);
      const drive = url.searchParams.get("drive");
      if (!drive) throw new HttpError(400, "BAD_REQUEST", "drive is required");
      const report = await findHealthReport(deps, drive);
      let status = "UNKNOWN";
      if (report) {
        try {
          const fresh = await deps.reactorClient.get(report.header.id);
          status = overallStatusOf(fresh.state);
        } catch (error) {
          // A public badge must never fabricate a PASS; an unreadable report
          // is honestly unknown.
          console.warn(
            `[http] badge could not read the health report: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return new Response(badgeSvg(status), {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=300",
        },
      });
    } catch (error) {
      return jsonError(error);
    }
  };
}