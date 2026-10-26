/**
 * The vault's health report, written by the browser vault: after the guide is written, and after
 * each source its pipeline processes. On a server the /health skill writes it; the browser has
 * neither, so it computes the same checks the dashboard shows (editors/knowledge-vault/lib/health-checks)
 * from the in-page graph and records them with the report's own operations.
 */
import type { IReactorClient } from "@powerhousedao/reactor";
import type { PHDocument } from "document-model";
import type { ExecutionResult } from "graphql";
import { actions } from "../document-models/health-report/index.js";
import { computeHealth, type HealthResult } from "../editors/knowledge-vault/lib/health-checks.js";
import { healthInputFromGraph, type GraphEdge, type GraphNode } from "../editors/knowledge-vault/lib/health-input.js";

export { healthInputFromGraph, type GraphEdge, type GraphNode } from "../editors/knowledge-vault/lib/health-input.js";

const GRAPH_QUERY = `query HealthGraph($driveId: ID!) {
  knowledgeGraphNodes(driveId: $driveId) { documentId title description noteType status documentType topics }
  knowledgeGraphEdges(driveId: $driveId) { sourceDocumentId targetDocumentId linkType }
}`;

type DriveFile = { id: string; kind: string; documentType?: string };

/**
 * Compute the vault's health and write it to the drive's `bai/health-report`: GENERATE_REPORT (which
 * clears the previous checks), then one ADD_CHECK per check. Null when the drive has no report.
 */
export async function writeHealthReport(deps: {
  client: IReactorClient;
  knowledgeGraph: { execute(body: { query: string; variables?: Record<string, unknown> }): Promise<ExecutionResult> };
  driveId: string;
  now?: () => Date;
}): Promise<HealthResult | null> {
  const drive = await deps.client.get<PHDocument>(deps.driveId);
  const files = ((drive.state as { global?: { nodes?: DriveFile[] } }).global?.nodes ?? []).filter((n) => n.kind === "file");
  const report = files.find((n) => n.documentType === "bai/health-report");
  if (!report) return null;

  const answer = await deps.knowledgeGraph.execute({ query: GRAPH_QUERY, variables: { driveId: deps.driveId } });
  if (answer.errors?.length) throw new Error(`The health check could not read the graph: ${answer.errors[0].message}`);
  const data = answer.data as { knowledgeGraphNodes: GraphNode[]; knowledgeGraphEdges: GraphEdge[] };
  const health = computeHealth(
    healthInputFromGraph({ nodes: data.knowledgeGraphNodes, edges: data.knowledgeGraphEdges, driveFileIds: files.map((f) => f.id) }),
  );
  const now = (deps.now ?? (() => new Date()))().toISOString();
  await deps.client.execute(report.id, "main", [
    actions.generateReport({
      generatedAt: now,
      generatedBy: "knowledge-vault-web",
      mode: "browser",
      overallStatus: health.overallStatus,
      graphMetrics: health.metrics,
      recommendations: health.recommendations.map((r) => r.text),
    }),
    ...health.checks.map((check) =>
      actions.addCheck({
        id: globalThis.crypto.randomUUID(),
        category: check.category as Parameters<typeof actions.addCheck>[0]["category"],
        status: check.status,
        message: check.message,
        affectedItems: check.affectedItems,
      }),
    ),
  ]);
  return health;
}
