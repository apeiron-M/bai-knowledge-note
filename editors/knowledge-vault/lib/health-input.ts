import type { HealthInput } from "./health-checks.js";

/**
 * The vault as the health checks read it (health-checks.ts), from the graph index's nodes and edges and the
 * drive's file ids. Shared by every writer of the health report: the Switchboard's `POST health` route and
 * the browser vault (browser/health.ts).
 */
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
