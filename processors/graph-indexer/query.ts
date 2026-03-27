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
      const nodes = await db.selectFrom("graph_nodes").selectAll().execute();
      const edges = await db.selectFrom("graph_edges").selectAll().execute();

      const targetIds = new Set(edges.map((e) => e.target_document_id));
      const orphanCount = nodes.filter((n) => !targetIds.has(n.document_id)).length;

      return {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        orphanCount,
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
      const nodes = await db.selectFrom("graph_nodes").selectAll().execute();
      const edges = await db.selectFrom("graph_edges").selectAll().execute();
      if (nodes.length <= 1) return 0;
      return edges.length / (nodes.length * (nodes.length - 1));
    },

    async searchNodes(query: string, limit = 50): Promise<GraphNodeResult[]> {
      const q = `%${query.toLowerCase()}%`;
      const rows = await db
        .selectFrom("graph_nodes")
        .where((eb) =>
          eb.or([
            eb(eb.fn("lower", ["title"]), "like", q),
            eb(eb.fn("lower", ["description"]), "like", q),
          ]),
        )
        .selectAll()
        .limit(limit)
        .execute();
      return rows.map(rowToNode);
    },

    async forwardLinks(documentId: string): Promise<GraphEdgeResult[]> {
      const rows = await db
        .selectFrom("graph_edges")
        .where("source_document_id", "=", documentId)
        .selectAll()
        .execute();
      return rows.map(rowToEdge);
    },

    async triangles(limit = 20): Promise<Array<{ a: GraphNodeResult; b: GraphNodeResult; sharedTarget: GraphNodeResult }>> {
      // Find pairs (A,B) that both link to C but A doesn't link to B
      const edges = await db.selectFrom("graph_edges").selectAll().execute();
      const nodeRows = await db.selectFrom("graph_nodes").selectAll().execute();
      const nodeMap = new Map(nodeRows.map((n) => [n.document_id, rowToNode(n)]));

      // Build incoming map: target → [source1, source2, ...]
      const incoming = new Map<string, string[]>();
      const edgeSet = new Set<string>();
      for (const e of edges) {
        const sources = incoming.get(e.target_document_id) ?? [];
        sources.push(e.source_document_id);
        incoming.set(e.target_document_id, sources);
        edgeSet.add(`${e.source_document_id}->${e.target_document_id}`);
      }

      const results: Array<{ a: GraphNodeResult; b: GraphNodeResult; sharedTarget: GraphNodeResult }> = [];

      for (const [targetId, sources] of incoming) {
        if (sources.length < 2) continue;
        const target = nodeMap.get(targetId);
        if (!target) continue;

        for (let i = 0; i < sources.length && results.length < limit; i++) {
          for (let j = i + 1; j < sources.length && results.length < limit; j++) {
            const aId = sources[i];
            const bId = sources[j];
            // Check if A→B or B→A exists
            if (!edgeSet.has(`${aId}->${bId}`) && !edgeSet.has(`${bId}->${aId}`)) {
              const a = nodeMap.get(aId);
              const b = nodeMap.get(bId);
              if (a && b) {
                results.push({ a, b, sharedTarget: target });
              }
            }
          }
        }
      }

      return results;
    },

    async bridges(): Promise<GraphNodeResult[]> {
      // Find articulation points using a simplified DFS approach
      const edges = await db.selectFrom("graph_edges").selectAll().execute();
      const nodeRows = await db.selectFrom("graph_nodes").selectAll().execute();
      const nodeMap = new Map(nodeRows.map((n) => [n.document_id, rowToNode(n)]));

      // Build undirected adjacency list
      const adj = new Map<string, Set<string>>();
      for (const e of edges) {
        if (!adj.has(e.source_document_id)) adj.set(e.source_document_id, new Set());
        if (!adj.has(e.target_document_id)) adj.set(e.target_document_id, new Set());
        adj.get(e.source_document_id)!.add(e.target_document_id);
        adj.get(e.target_document_id)!.add(e.source_document_id);
      }

      const allNodes = [...adj.keys()];
      if (allNodes.length <= 2) return [];

      // For each node, check if removing it increases connected components
      const bridgeNodes: GraphNodeResult[] = [];

      function countComponents(exclude: string): number {
        const remaining = allNodes.filter((n) => n !== exclude);
        if (remaining.length === 0) return 0;
        const visited = new Set<string>();
        let components = 0;

        for (const start of remaining) {
          if (visited.has(start)) continue;
          components++;
          const stack = [start];
          while (stack.length > 0) {
            const current = stack.pop()!;
            if (visited.has(current)) continue;
            visited.add(current);
            for (const neighbor of adj.get(current) ?? []) {
              if (neighbor !== exclude && !visited.has(neighbor)) {
                stack.push(neighbor);
              }
            }
          }
        }
        return components;
      }

      const baseComponents = countComponents("");

      for (const nodeId of allNodes) {
        if (countComponents(nodeId) > baseComponents) {
          const node = nodeMap.get(nodeId);
          if (node) bridgeNodes.push(node);
        }
      }

      return bridgeNodes;
    },
  };
}
