import type { RouteContext } from "@powerhousedao/shared/processors";
import { computeHealth } from "../../../editors/knowledge-vault/lib/health-checks.js";
import { healthInputFromGraph } from "../../../editors/knowledge-vault/lib/health-input.js";
import type { GraphEdgeResult, GraphNodeResult } from "../../../processors/graph-indexer/query.js";
import { canonicalForRead, canonicalForWrite } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { findDocumentInDrive } from "../lib/drive-tree.js";
import { badgeSvg, overallStatusOf } from "../lib/health.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";
import { timed } from "../lib/slow.js";
import { executeWrite } from "../lib/write.js";

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

/** The graph index's reads the health check needs. */
export type HealthGraph = {
  allNodes(): Promise<GraphNodeResult[]>;
  allEdges(): Promise<GraphEdgeResult[]>;
  topicsByDocument(): Promise<Map<string, string[]>>;
};

/**
 * `POST health?drive=`: grade the vault and rewrite its health report, the snapshot the vault's dashboard shows.
 *
 * The checks are the dashboard's own (health-checks.ts), computed from the graph index, as the browser vault
 * computes them in the page. GENERATE_REPORT clears the last run's checks, so it goes first, then one ADD_CHECK
 * per check, all in one write that is read back. It measures and records; repairs stay with /health and the person.
 *
 * `when=idle` is how the workflows call it, at the end of each source's run and of each reweave: it writes only
 * once the batch is through (no other source waiting or in progress), and not at all when the grade is the one
 * already on file. A batch of twenty sources gets one report, after the last, never a snapshot of a half-processed
 * vault; and the report's history gains an entry only when the vault's health changed.
 */
/**
 * A source still on its way: PENDING or IN_PROGRESS, touched in the last two hours (a step may take one). An older
 * one is stuck, the queue watchdog's business, and does not hold the report back.
 */
const BUSY_FOR_MS = 2 * 60 * 60 * 1000;
type QueueTask = { status: string; updatedAt?: string | null; createdAt?: string | null };
export function openTasks(tasks: readonly QueueTask[], now: number): number {
  return tasks.filter((t) => (t.status === "PENDING" || t.status === "IN_PROGRESS") && now - Date.parse(t.updatedAt ?? t.createdAt ?? "") < BUSY_FOR_MS).length;
}

type StoredReport = { overallStatus?: unknown; graphMetrics?: unknown; recommendations?: unknown; checks?: { category: string; status: string; message: string; affectedItems: string[] }[] };
/** Whether a grade is the one already on file: same status, metrics, checks and recommendations. */
export function sameReport(stored: StoredReport | undefined, health: { overallStatus: string; metrics: object; checks: { category: string; status: string; message: string; affectedItems: string[] }[]; recommendations: { text: string }[] }): boolean {
  if (!stored?.checks) return false;
  const checks = (list: readonly { category: string; status: string; message: string; affectedItems: string[] }[]) =>
    JSON.stringify(list.map((c) => JSON.stringify([c.category, c.status, c.message, [...c.affectedItems].sort()])).sort());
  return (
    stored.overallStatus === health.overallStatus &&
    JSON.stringify(stored.graphMetrics) === JSON.stringify(health.metrics) &&
    JSON.stringify(stored.recommendations) === JSON.stringify(health.recommendations.map((r) => r.text)) &&
    checks(stored.checks) === checks(health.checks)
  );
}

export function createHealthWriteRoute(deps: HttpRouteDeps & { getQuery: (driveId: string) => HealthGraph; now?: () => Date }) {
  return async function handleHealthWrite(request: Request, ctx: RouteContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const drive = url.searchParams.get("drive");
      if (!drive) throw new HttpError(400, "BAD_REQUEST", "drive is required");
      const driveId = await canonicalForRead(deps, drive, ctx);
      const reportId = await healthReportId(deps, driveId);
      if (!reportId) throw new HttpError(404, "NOT_FOUND", "No health report in this drive");
      const canonicalReport = await canonicalForWrite(deps, reportId, ctx);
      const idle = url.searchParams.get("when") === "idle";
      const clock = deps.now ?? (() => new Date());

      if (idle) {
        const queueId = await findDocumentInDrive(deps, driveId, "bai/pipeline-queue");
        const queue = queueId ? await deps.reactorClient.get(queueId) : undefined;
        const open = openTasks((queue?.state as { global?: { tasks?: QueueTask[] } } | undefined)?.global?.tasks ?? [], clock().getTime());
        if (open > 0) return Response.json({ reportId: canonicalReport, skipped: "busy", openTasks: open });
      }

      const graph = deps.getQuery(driveId);
      const [driveDoc, nodes, edges, topics] = await timed("health: read the graph", () =>
        Promise.all([deps.reactorClient.get(driveId), graph.allNodes(), graph.allEdges(), graph.topicsByDocument()]),
      );
      const driveFileIds = ((driveDoc.state as { global?: { nodes?: { id: string; kind?: string }[] } } | undefined)?.global?.nodes ?? [])
        .filter((n) => n.kind === "file")
        .map((n) => n.id);
      const health = computeHealth(
        healthInputFromGraph({
          nodes: nodes.map((n) => ({
            documentId: n.documentId,
            title: n.title,
            description: n.description,
            noteType: n.noteType,
            status: n.status,
            documentType: n.documentType,
            topics: topics.get(n.documentId) ?? [],
          })),
          edges: edges.map((e) => ({ sourceDocumentId: e.sourceDocumentId, targetDocumentId: e.targetDocumentId, linkType: e.linkType })),
          driveFileIds,
        }),
      );

      const generatedAt = clock().toISOString();
      const report = await deps.reactorClient.get(canonicalReport);
      if (idle && sameReport((report.state as { global?: StoredReport } | undefined)?.global, health)) {
        return Response.json({ reportId: canonicalReport, skipped: "unchanged", overallStatus: health.overallStatus });
      }
      const result = await executeWrite(deps, {
        documentId: canonicalReport,
        document: report,
        ctx,
        wait: true,
        actions: [
          {
            type: "GENERATE_REPORT",
            scope: "global",
            input: {
              generatedAt,
              generatedBy: url.searchParams.get("by") ?? "knowledge-vault",
              mode: "full",
              overallStatus: health.overallStatus,
              graphMetrics: health.metrics,
              recommendations: health.recommendations.map((r) => r.text),
            },
          },
          ...health.checks.map((check) => ({
            type: "ADD_CHECK",
            scope: "global",
            input: { id: globalThis.crypto.randomUUID(), category: check.category, status: check.status, message: check.message, affectedItems: check.affectedItems },
          })),
        ],
      });
      const rejected = result.operations.filter((op) => op.error);
      if (rejected.length) {
        throw new HttpError(502, "WRITE_REJECTED", `The health report refused ${rejected.length} of its operations: ${rejected[0].error}`);
      }
      return Response.json({
        reportId: canonicalReport,
        generatedAt,
        overallStatus: health.overallStatus,
        metrics: health.metrics,
        checks: health.checks.map((c) => ({ category: c.category, status: c.status, message: c.message })),
        recommendations: health.recommendations.map((r) => r.text),
        readBack: result.readBack,
      });
    } catch (error) {
      return jsonError(error);
    }
  };
}
