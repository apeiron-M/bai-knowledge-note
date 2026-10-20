import type { RouteContext } from "@powerhousedao/shared/processors";
import { canonicalForRead } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { findDocumentInDrive } from "../lib/drive-tree.js";
import { badgeSvg, overallStatusOf } from "../lib/health.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";

async function healthReportId(deps: HttpRouteDeps, drive: string) {
  return findDocumentInDrive(deps, drive, "bai/health-report");
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
      const reportId = await healthReportId(deps, drive);
      if (!reportId) {
        throw new HttpError(404, "NOT_FOUND", "No health report in this drive");
      }
      await canonicalForRead(deps, reportId, ctx);
      const report = await deps.reactorClient.get(reportId);
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
      const reportId = await healthReportId(deps, drive);
      let status = "UNKNOWN";
      if (reportId) {
        try {
          const report = await deps.reactorClient.get(reportId);
          status = overallStatusOf(report.state);
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