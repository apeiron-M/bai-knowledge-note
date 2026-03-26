import type { Kysely } from "kysely";
import type { DB, GraphNode, GraphEdge } from "./schema.js";

export interface GraphNodeResult {
  id: string;
  documentId: string;
  title: string | null;
  description: string | null;
  noteType: string | null;
  status: string | null;
  updatedAt: string;
}

export interface GraphEdgeResult {
  id: string;
  sourceDocumentId: string;
  targetDocumentId: string;
  linkType: string | null;
  targetTitle: string | null;
  updatedAt: string;
}

export interface GraphStatsResult {
  nodeCount: number;
  edgeCount: number;
  orphanCount: number;
}

export interface ConnectionResult {
  node: GraphNodeResult;
  depth: number;
  viaLinkType: string | null;
}

function rowToNode(row: GraphNode): GraphNodeResult {
  return {
    id: row.id,
    documentId: row.document_id,
    title: row.title,
    description: row.description,
    noteType: row.note_type,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function rowToEdge(row: GraphEdge): GraphEdgeResult {
  return {
    id: row.id,
    sourceDocumentId: row.source_document_id,
    targetDocumentId: row.target_document_id,
    linkType: row.link_type,
    targetTitle: row.target_title,
    updatedAt: row.updated_at,
  };
}

export function createGraphQuery(db: Kysely<DB>) {
  return {
    async allNodes(): Promise<GraphNodeResult[]> {
      const rows = await db.selectFrom("graph_nodes").selectAll().execute();
      return rows.map(rowToNode);
    },

    async allEdges(): Promise<GraphEdgeResult[]> {
      const rows = await db.selectFrom("graph_edges").selectAll().execute();
      return rows.map(rowToEdge);
    },

    async nodeByDocumentId(
      documentId: string,
    ): Promise<GraphNodeResult | undefined> {
      const row = await db
        .selectFrom("graph_nodes")
        .where("document_id", "=", documentId)
        .selectAll()
        .executeTakeFirst();
      return row ? rowToNode(row) : undefined;
    },

    async nodesByStatus(status: string): Promise<GraphNodeResult[]> {
      const rows = await db
        .selectFrom("graph_nodes")
        .where("status", "=", status)
        .selectAll()
        .execute();
      return rows.map(rowToNode);
    },

    async orphanNodes(): Promise<GraphNodeResult[]> {
      // Nodes that have zero incoming edges
      const rows = await db
        .selectFrom("graph_nodes")
        .selectAll()
        .where(
          "document_id",
          "not in",
          db.selectFrom("graph_edges").select("target_document_id"),
        )
        .execute();
      return rows.map(rowToNode);
    },

    async stats(): Promise<GraphStatsResult> {
      const nodeCountResult = await db
        .selectFrom("graph_nodes")
        .select(db.fn.countAll().as("count"))
        .executeTakeFirst();

      const edgeCountResult = await db
        .selectFrom("graph_edges")
        .select(db.fn.countAll().as("count"))
        .executeTakeFirst();

      // Orphan count: nodes not appearing as target in any edge
      const orphanCountResult = await db
        .selectFrom("graph_nodes")
        .select(db.fn.countAll().as("count"))
        .where(
          "document_id",
          "not in",
          db.selectFrom("graph_edges").select("target_document_id"),
        )
        .executeTakeFirst();

      return {
        nodeCount: Number(nodeCountResult?.count ?? 0),
        edgeCount: Number(edgeCountResult?.count ?? 0),
        orphanCount: Number(orphanCountResult?.count ?? 0),
      };
    },

    async connections(
      documentId: string,
      maxDepth = 2,
    ): Promise<ConnectionResult[]> {
      const results: ConnectionResult[] = [];
      const visited = new Set<string>();
      visited.add(documentId);

      let frontier = [documentId];

      for (let depth = 1; depth <= maxDepth; depth++) {
        if (frontier.length === 0) break;

        const edges = await db
          .selectFrom("graph_edges")
          .where("source_document_id", "in", frontier)
          .selectAll()
          .execute();

        const nextFrontier: string[] = [];

        for (const edge of edges) {
          if (visited.has(edge.target_document_id)) continue;
          visited.add(edge.target_document_id);

          const node = await db
            .selectFrom("graph_nodes")
            .where("document_id", "=", edge.target_document_id)
            .selectAll()
            .executeTakeFirst();

          if (node) {
            results.push({
              node: rowToNode(node),
              depth,
              viaLinkType: edge.link_type,
            });
            nextFrontier.push(edge.target_document_id);
          }
        }

        frontier = nextFrontier;
      }

      return results;
    },

    async backlinks(documentId: string): Promise<GraphEdgeResult[]> {
      const rows = await db
        .selectFrom("graph_edges")
        .where("target_document_id", "=", documentId)
        .selectAll()
        .execute();
      return rows.map(rowToEdge);
    },

    async density(): Promise<number> {
      const nodeCount = Number(
        (await db.selectFrom("graph_nodes").select(db.fn.countAll().as("count")).executeTakeFirst())?.count ?? 0,
      );
      const edgeCount = Number(
        (await db.selectFrom("graph_edges").select(db.fn.countAll().as("count")).executeTakeFirst())?.count ?? 0,
      );
      if (nodeCount <= 1) return 0;
      return edgeCount / (nodeCount * (nodeCount - 1));
    },
  };
}
