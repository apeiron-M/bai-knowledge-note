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
import { computeHealth, type HealthInput, type HealthResult } from "../editors/knowledge-vault/lib/health-checks.js";

export type GraphNode = {
  documentId: string;
  title: string | null;
  description: string | null;
  noteType: string | null;
  status: string | null;
  documentType: string | null;
  topics: string[];
};
export type GraphEdge = { sourceDocumentId: string; targetDocumentId: string; linkType: string | null };

/** The links a health check counts: between notes, as people draw them (not a note's source, not a map's members). */
const NOTE_LINKS = new Set(["RELATES_TO", "BUILDS_ON", "CONTRADICTS", "SUPERSEDES"]);

/** The vault as the health check reads it, from the graph and the drive's file ids. */
export function healthInputFromGraph(graph: { nodes: GraphNode[]; edges: GraphEdge[]; driveFileIds: readonly string[] }): HealthInput {
  const of = (type: string) => graph.nodes.filter((n) => n.documentType === type);
  const notes = of("bai/knowledge-note").filter((n) => n.status !== "ARCHIVED");
  const out = (from: string, types: (t: string | null) => boolean) =>
    graph.edges.filter((e) => e.sourceDocumentId === from && types(e.linkType)).map((e) => e.targetDocumentId);
  return {
    notes: notes.map((n) => ({
      id: n.documentId,
      title: n.title ?? n.documentId,
      description: n.description,
      noteType: n.noteType,
      topics: n.topics,
      links: out(n.documentId, (t) => t !== null && NOTE_LINKS.has(t)),
    })),
    mocs: of("bai/moc").map((m) => ({ id: m.documentId, coreIdeas: out(m.documentId, (t) => t === "CORE_IDEA") })),
    pendingObservations: of("bai/observation")
      .filter((o) => o.status === "PENDING")
      .map((o) => ({ id: o.documentId, title: o.title ?? o.documentId })),
    openTensions: of("bai/tension")
      .filter((t) => t.status === "OPEN")
      .map((t) => ({ id: t.documentId, title: t.title ?? t.documentId })),
    otherDocumentIds: [...new Set([...graph.driveFileIds, ...graph.nodes.map((n) => n.documentId)])],
  };
}

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
