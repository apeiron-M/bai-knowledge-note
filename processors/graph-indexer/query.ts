import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { DB, GraphNode, GraphEdge } from "./schema.js";

export interface GraphNodeResult {
  id: string;
  documentId: string;
  title: string | null;
  description: string | null;
  noteType: string | null;
  status: string | null;
  content: string | null;
  author: string | null;
  sourceOrigin: string | null;
  createdAt: string | null;
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

export interface TopicStatsResult {
  name: string;
  noteCount: number;
}

export interface RelatedByTopicResult {
  node: GraphNodeResult;
  sharedTopics: string[];
  sharedTopicCount: number;
}

export interface HybridSearchResult {
  node: GraphNodeResult;
  score: number;
  matchedBy: string[];
}

export interface OperationRecord {
  id: string;
  documentId: string;
  operationType: string;
  timestamp: string;
  index: number;
  scope: string;
  summary: string | null;
}

function rowToNode(row: GraphNode): GraphNodeResult {
  return {
    id: row.id,
    documentId: row.document_id,
    title: row.title,
    description: row.description,
    noteType: row.note_type,
    status: row.status,
    content: row.content,
    author: row.author,
    sourceOrigin: row.source_origin,
    createdAt: row.created_at,
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

function rowToOperation(row: {
  id: string;
  document_id: string;
  operation_type: string;
  timestamp: string;
  index: number;
  scope: string;
  summary: string | null;
  input_json: string | null;
}): OperationRecord {
  return {
    id: row.id,
    documentId: row.document_id,
    operationType: row.operation_type,
    timestamp: row.timestamp,
    index: row.index,
    scope: row.scope,
    summary: row.summary,
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
        .select(sql<number>`count(*)`.as("cnt"))
        .executeTakeFirstOrThrow();
      const edgeCountResult = await db
        .selectFrom("graph_edges")
        .select(sql<number>`count(*)`.as("cnt"))
        .executeTakeFirstOrThrow();

      // Orphans: nodes not targeted by any edge
      const orphanResult = await db
        .selectFrom("graph_nodes")
        .select(sql<number>`count(*)`.as("cnt"))
        .where(
          "document_id",
          "not in",
          db.selectFrom("graph_edges").select("target_document_id"),
        )
        .executeTakeFirstOrThrow();

      return {
        nodeCount: Number(nodeCountResult.cnt),
        edgeCount: Number(edgeCountResult.cnt),
        orphanCount: Number(orphanResult.cnt),
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
      const nodeCountResult = await db
        .selectFrom("graph_nodes")
        .select(sql<number>`count(*)`.as("cnt"))
        .executeTakeFirstOrThrow();
      const edgeCountResult = await db
        .selectFrom("graph_edges")
        .select(sql<number>`count(*)`.as("cnt"))
        .executeTakeFirstOrThrow();
      const nodeCount = Number(nodeCountResult.cnt);
      const edgeCount = Number(edgeCountResult.cnt);
      if (nodeCount <= 1) return 0;
      return edgeCount / (nodeCount * (nodeCount - 1));
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

    async triangles(limit = 20): Promise<
      Array<{
        a: GraphNodeResult;
        b: GraphNodeResult;
        sharedTarget: GraphNodeResult;
      }>
    > {
      // Find pairs (A,B) that both link to C but A doesn't link to B
      const edges = await db.selectFrom("graph_edges").selectAll().execute();
      const nodeRows = await db.selectFrom("graph_nodes").selectAll().execute();
      const nodeMap = new Map(
        nodeRows.map((n) => [n.document_id, rowToNode(n)]),
      );

      // Build incoming map: target -> [source1, source2, ...]
      const incoming = new Map<string, string[]>();
      const edgeSet = new Set<string>();
      for (const e of edges) {
        const sources = incoming.get(e.target_document_id) ?? [];
        sources.push(e.source_document_id);
        incoming.set(e.target_document_id, sources);
        edgeSet.add(`${e.source_document_id}->${e.target_document_id}`);
      }

      const results: Array<{
        a: GraphNodeResult;
        b: GraphNodeResult;
        sharedTarget: GraphNodeResult;
      }> = [];

      for (const [targetId, sources] of incoming) {
        if (sources.length < 2) continue;
        const target = nodeMap.get(targetId);
        if (!target) continue;

        for (let i = 0; i < sources.length && results.length < limit; i++) {
          for (
            let j = i + 1;
            j < sources.length && results.length < limit;
            j++
          ) {
            const aId = sources[i];
            const bId = sources[j];
            // Check if A->B or B->A exists
            if (
              !edgeSet.has(`${aId}->${bId}`) &&
              !edgeSet.has(`${bId}->${aId}`)
            ) {
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
      const nodeMap = new Map(
        nodeRows.map((n) => [n.document_id, rowToNode(n)]),
      );

      // Build undirected adjacency list
      const adj = new Map<string, Set<string>>();
      for (const e of edges) {
        if (!adj.has(e.source_document_id))
          adj.set(e.source_document_id, new Set());
        if (!adj.has(e.target_document_id))
          adj.set(e.target_document_id, new Set());
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

    // --- Phase 1: topics, content, provenance queries ---

    async topicStats(): Promise<TopicStatsResult[]> {
      const rows = await db
        .selectFrom("graph_topics")
        .select(["name"])
        .select(sql<number>`count(*)`.as("note_count"))
        .groupBy("name")
        .orderBy(sql`count(*)`, "desc")
        .execute();
      return rows.map((r) => ({
        name: r.name,
        noteCount: Number(r.note_count),
      }));
    },

    async topicsForNode(documentId: string): Promise<string[]> {
      const rows = await db
        .selectFrom("graph_topics")
        .where("document_id", "=", documentId)
        .select("name")
        .execute();
      return rows.map((r) => r.name);
    },

    async nodesByTopic(topic: string): Promise<GraphNodeResult[]> {
      const rows = await db
        .selectFrom("graph_nodes")
        .innerJoin(
          "graph_topics",
          "graph_nodes.document_id",
          "graph_topics.document_id",
        )
        .where("graph_topics.name", "=", topic)
        .selectAll("graph_nodes")
        .execute();
      return rows.map(rowToNode);
    },

    async relatedByTopic(
      documentId: string,
      limit = 10,
    ): Promise<RelatedByTopicResult[]> {
      // Get topics of the source document
      const sourceTopics = await db
        .selectFrom("graph_topics")
        .where("document_id", "=", documentId)
        .select("name")
        .execute();

      if (sourceTopics.length === 0) return [];

      const topicNames = sourceTopics.map((t) => t.name);

      // Find other documents sharing those topics
      const rows = await db
        .selectFrom("graph_topics")
        .where("document_id", "!=", documentId)
        .where("name", "in", topicNames)
        .select(["document_id", "name"])
        .execute();

      // Group by document_id
      const docTopics = new Map<string, string[]>();
      for (const row of rows) {
        const existing = docTopics.get(row.document_id) ?? [];
        existing.push(row.name);
        docTopics.set(row.document_id, existing);
      }

      // Sort by shared topic count descending
      const sorted = [...docTopics.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, limit);

      const results: RelatedByTopicResult[] = [];
      for (const [docId, shared] of sorted) {
        const node = await db
          .selectFrom("graph_nodes")
          .where("document_id", "=", docId)
          .selectAll()
          .executeTakeFirst();
        if (node) {
          results.push({
            node: rowToNode(node),
            sharedTopics: shared,
            sharedTopicCount: shared.length,
          });
        }
      }

      return results;
    },

    async fullSearch(query: string, limit = 50): Promise<GraphNodeResult[]> {
      const q = `%${query.toLowerCase()}%`;
      const rows = await db
        .selectFrom("graph_nodes")
        .where((eb) =>
          eb.or([
            eb(eb.fn("lower", ["title"]), "like", q),
            eb(eb.fn("lower", ["description"]), "like", q),
            eb(eb.fn("lower", ["content"]), "like", q),
          ]),
        )
        .selectAll()
        .limit(limit)
        .execute();
      return rows.map(rowToNode);
    },

    async nodesByAuthor(author: string): Promise<GraphNodeResult[]> {
      const rows = await db
        .selectFrom("graph_nodes")
        .where("author", "=", author)
        .selectAll()
        .execute();
      return rows.map(rowToNode);
    },

    async nodesByOrigin(origin: string): Promise<GraphNodeResult[]> {
      const rows = await db
        .selectFrom("graph_nodes")
        .where("source_origin", "=", origin)
        .selectAll()
        .execute();
      return rows.map(rowToNode);
    },

    async recentNodes(limit = 20, since?: string): Promise<GraphNodeResult[]> {
      let query = db
        .selectFrom("graph_nodes")
        .selectAll()
        .orderBy("created_at", "desc")
        .limit(limit);

      if (since) {
        query = query.where("created_at", ">", since);
      }

      const rows = await query.execute();
      return rows.map(rowToNode);
    },

    /**
     * Hybrid search: run keyword + semantic in parallel, merge via
     * Reciprocal Rank Fusion (RRF). semanticResults must be pre-fetched
     * from the embedding store by the caller.
     */
    async hybridSearch(
      keywordQuery: string,
      semanticResults: Array<{ documentId: string; similarity: number }>,
      limit = 20,
    ): Promise<HybridSearchResult[]> {
      const K = 60;
      const scores = new Map<
        string,
        { score: number; matchedBy: string[]; node?: GraphNodeResult }
      >();

      // Keyword leg
      const keywordResults = await this.fullSearch(keywordQuery, limit * 2);
      keywordResults.forEach((node, rank) => {
        const existing = scores.get(node.documentId) ?? {
          score: 0,
          matchedBy: [],
        };
        existing.score += 1 / (K + rank);
        existing.matchedBy.push("keyword");
        existing.node = node;
        scores.set(node.documentId, existing);
      });

      // Semantic leg
      for (let rank = 0; rank < semanticResults.length; rank++) {
        const sr = semanticResults[rank];
        const existing = scores.get(sr.documentId) ?? {
          score: 0,
          matchedBy: [],
        };
        existing.score += 1 / (K + rank);
        if (!existing.matchedBy.includes("semantic")) {
          existing.matchedBy.push("semantic");
        }
        // Fetch node data if we don't have it from keyword results
        if (!existing.node) {
          existing.node = await this.nodeByDocumentId(sr.documentId);
        }
        scores.set(sr.documentId, existing);
      }

      return [...scores.values()]
        .filter((e): e is typeof e & { node: GraphNodeResult } => !!e.node)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ score, matchedBy, node }) => ({ node, score, matchedBy }));
    },

    // ---- Operation history queries ----

    async history(documentId: string, limit = 50): Promise<OperationRecord[]> {
      const rows = await db
        .selectFrom("graph_operations")
        .where("document_id", "=", documentId)
        .orderBy("index", "desc")
        .selectAll()
        .limit(limit)
        .execute();
      return rows.map(rowToOperation);
    },

    async activity(limit = 50, since?: string): Promise<OperationRecord[]> {
      let query = db
        .selectFrom("graph_operations")
        .orderBy("timestamp", "desc")
        .selectAll()
        .limit(limit);

      if (since) {
        query = query.where("timestamp", ">", since);
      }

      const rows = await query.execute();
      return rows.map(rowToOperation);
    },

    async activityByType(
      operationType: string,
      limit = 50,
    ): Promise<OperationRecord[]> {
      const rows = await db
        .selectFrom("graph_operations")
        .where("operation_type", "=", operationType)
        .orderBy("timestamp", "desc")
        .selectAll()
        .limit(limit)
        .execute();
      return rows.map(rowToOperation);
    },

    async staleNodes(since: string, limit = 50): Promise<GraphNodeResult[]> {
      // Nodes with no operations after `since` but that have neighbors
      // who DO have operations after `since`
      const staleRows = await db
        .selectFrom("graph_nodes")
        .where(
          "document_id",
          "not in",
          db
            .selectFrom("graph_operations")
            .where("timestamp", ">", since)
            .select("document_id"),
        )
        .where("updated_at", "<", since)
        .selectAll()
        .limit(limit)
        .execute();
      return staleRows.map(rowToNode);
    },
  };
}
