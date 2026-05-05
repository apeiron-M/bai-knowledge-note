import type { ISubgraph } from "@powerhousedao/reactor-api";
import { getDb, getQuery } from "./helpers/db.js";
import { ensureGraphDoc } from "./helpers/ensure-graph-doc.js";
import { reindexDrive } from "./helpers/reindex.js";
import { GraphIndexerProcessor } from "../../processors/graph-indexer/index.js";
import { generateEmbedding } from "../../processors/graph-indexer/embedder.js";
import {
  searchSimilar,
  getEmbedding,
} from "../../processors/graph-indexer/embedding-store.js";

export const getResolvers = (subgraph: ISubgraph): Record<string, unknown> => {
  return {
    KnowledgeGraphNode: {
      topics: async (parent: {
        documentId: string;
        topics?: string[];
        _driveId?: string;
      }) => {
        if (parent.topics) return parent.topics;
        if (parent._driveId) {
          const query = getQuery(subgraph, parent._driveId);
          return query.topicsForNode(parent.documentId);
        }
        return [];
      },
    },

    Mutation: {
      knowledgeGraphReindex: (_: unknown, args: { driveId: string }) =>
        reindexDrive(subgraph, args.driveId),
    },

    Query: {
      // --- Core graph queries ---

      knowledgeGraphNodes: async (_: unknown, args: { driveId: string }) => {
        await ensureGraphDoc(subgraph, args.driveId);
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.allNodes();
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphEdges: async (_: unknown, args: { driveId: string }) => {
        await ensureGraphDoc(subgraph, args.driveId);
        const query = getQuery(subgraph, args.driveId);
        return query.allEdges();
      },

      knowledgeGraphStats: async (_: unknown, args: { driveId: string }) => {
        await ensureGraphDoc(subgraph, args.driveId);
        const query = getQuery(subgraph, args.driveId);
        return query.stats();
      },

      knowledgeGraphNodeByDocumentId: async (
        _: unknown,
        args: { driveId: string; documentId: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const node = await query.nodeByDocumentId(args.documentId);
        return node ? { ...node, _driveId: args.driveId } : null;
      },

      knowledgeGraphOrphans: async (_: unknown, args: { driveId: string }) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.orphanNodes();
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphConnections: async (
        _: unknown,
        args: { driveId: string; documentId: string; depth?: number },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const connections = await query.connections(
          args.documentId,
          args.depth ?? 2,
        );
        return connections.map((c) => ({
          ...c,
          node: { ...c.node, _driveId: args.driveId },
        }));
      },

      knowledgeGraphNodesByStatus: async (
        _: unknown,
        args: { driveId: string; status: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.nodesByStatus(args.status);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphBacklinks: async (
        _: unknown,
        args: { driveId: string; documentId: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        return query.backlinks(args.documentId);
      },

      knowledgeGraphDensity: async (_: unknown, args: { driveId: string }) => {
        const query = getQuery(subgraph, args.driveId);
        return query.density();
      },

      // --- Search queries ---

      knowledgeGraphSearch: async (
        _: unknown,
        args: { driveId: string; query: string; limit?: number },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.searchNodes(args.query, args.limit ?? 50);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphTriangles: async (
        _: unknown,
        args: { driveId: string; limit?: number },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const triangles = await query.triangles(args.limit ?? 20);
        return triangles.map((t) => ({
          noteA: { ...t.a, _driveId: args.driveId },
          noteB: { ...t.b, _driveId: args.driveId },
          sharedTarget: { ...t.sharedTarget, _driveId: args.driveId },
        }));
      },

      knowledgeGraphBridges: async (_: unknown, args: { driveId: string }) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.bridges();
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphForwardLinks: async (
        _: unknown,
        args: { driveId: string; documentId: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        return query.forwardLinks(args.documentId);
      },

      // --- Topic queries ---

      knowledgeGraphTopics: async (_: unknown, args: { driveId: string }) => {
        const query = getQuery(subgraph, args.driveId);
        return query.topicStats();
      },

      knowledgeGraphByTopic: async (
        _: unknown,
        args: { driveId: string; topic: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.nodesByTopic(args.topic);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphRelatedByTopic: async (
        _: unknown,
        args: { driveId: string; documentId: string; limit?: number },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const results = await query.relatedByTopic(
          args.documentId,
          args.limit ?? 10,
        );
        return results.map((r) => ({
          ...r,
          node: { ...r.node, _driveId: args.driveId },
        }));
      },

      knowledgeGraphFullSearch: async (
        _: unknown,
        args: { driveId: string; query: string; limit?: number },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.fullSearch(args.query, args.limit ?? 50);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      // --- Provenance queries ---

      knowledgeGraphByAuthor: async (
        _: unknown,
        args: { driveId: string; author: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.nodesByAuthor(args.author);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphByOrigin: async (
        _: unknown,
        args: { driveId: string; origin: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.nodesByOrigin(args.origin);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphRecent: async (
        _: unknown,
        args: { driveId: string; limit?: number; since?: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.recentNodes(
          args.limit ?? 20,
          args.since ?? undefined,
        );
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      // --- Semantic search queries ---

      knowledgeGraphSemanticSearch: async (
        _: unknown,
        args: { driveId: string; query: string; limit?: number },
      ) => {
        const queryEmbedding = await generateEmbedding(args.query);
        const results = await searchSimilar(queryEmbedding, args.limit ?? 10);
        const graphQuery = getQuery(subgraph, args.driveId);

        const semanticResults = [];
        for (const result of results) {
          const node = await graphQuery.nodeByDocumentId(result.documentId);
          if (node) {
            semanticResults.push({
              node: { ...node, _driveId: args.driveId },
              similarity: result.similarity,
            });
          }
        }
        return semanticResults;
      },

      knowledgeGraphSimilar: async (
        _: unknown,
        args: { driveId: string; documentId: string; limit?: number },
      ) => {
        const embedding = await getEmbedding(args.documentId);
        if (!embedding) return [];

        const results = await searchSimilar(embedding, (args.limit ?? 10) + 1);
        const graphQuery = getQuery(subgraph, args.driveId);

        const semanticResults = [];
        for (const result of results) {
          if (result.documentId === args.documentId) continue;
          const node = await graphQuery.nodeByDocumentId(result.documentId);
          if (node) {
            semanticResults.push({
              node: { ...node, _driveId: args.driveId },
              similarity: result.similarity,
            });
          }
        }
        return semanticResults.slice(0, args.limit ?? 10);
      },

      knowledgeGraphHybridSearch: async (
        _: unknown,
        args: { driveId: string; query: string; limit?: number },
      ) => {
        const queryEmbedding = await generateEmbedding(args.query);
        const semanticResults = await searchSimilar(
          queryEmbedding,
          (args.limit ?? 20) * 2,
        );
        const graphQuery = getQuery(subgraph, args.driveId);
        const hybridResults = await graphQuery.hybridSearch(
          args.query,
          semanticResults,
          args.limit ?? 20,
        );
        return hybridResults.map((r) => ({
          node: { ...r.node, _driveId: args.driveId },
          score: r.score,
          matchedBy: r.matchedBy,
        }));
      },

      // --- History queries ---

      knowledgeGraphHistory: async (
        _: unknown,
        args: { driveId: string; documentId: string; limit?: number },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        return query.history(args.documentId, args.limit ?? 50);
      },

      knowledgeGraphActivity: async (
        _: unknown,
        args: { driveId: string; limit?: number; since?: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        return query.activity(args.limit ?? 50, args.since ?? undefined);
      },

      knowledgeGraphActivityByType: async (
        _: unknown,
        args: { driveId: string; operationType: string; limit?: number },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        return query.activityByType(args.operationType, args.limit ?? 50);
      },

      knowledgeGraphStale: async (
        _: unknown,
        args: { driveId: string; since: string; limit?: number },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.staleNodes(args.since, args.limit ?? 50);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      // --- Debug ---

      knowledgeGraphDebug: async (_: unknown, args: { driveId: string }) => {
        const namespace = GraphIndexerProcessor.getNamespace(args.driveId);
        try {
          const db = getDb(subgraph, args.driveId);
          const rawNodes = await db
            .selectFrom("graph_nodes")
            .selectAll()
            .execute();
          const rawEdges = await db
            .selectFrom("graph_edges")
            .selectAll()
            .execute();
          return {
            rawNodeCount: rawNodes.length,
            rawEdgeCount: rawEdges.length,
            rawNodes: rawNodes.map((r) => ({
              id: r.id,
              documentId: r.document_id,
              title: r.title,
              description: r.description,
              noteType: r.note_type,
              status: r.status,
              content: r.content,
              author: r.author,
              sourceOrigin: r.source_origin,
              createdAt: r.created_at,
              topics: [],
              updatedAt: r.updated_at,
              _driveId: args.driveId,
            })),
            rawEdges: rawEdges.map((r) => ({
              id: r.id,
              sourceDocumentId: r.source_document_id,
              targetDocumentId: r.target_document_id,
              linkType: r.link_type,
              targetTitle: r.target_title,
              updatedAt: r.updated_at,
            })),
            processorNamespace: namespace,
          };
        } catch (err: unknown) {
          console.warn(
            `[KnowledgeGraphSubgraph] Debug query failed for ${namespace}:`,
            err,
          );
          return {
            rawNodeCount: 0,
            rawEdgeCount: 0,
            rawNodes: [],
            rawEdges: [],
            processorNamespace: namespace,
          };
        }
      },
    },
  };
};
