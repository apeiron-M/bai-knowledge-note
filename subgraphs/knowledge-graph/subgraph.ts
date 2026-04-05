import { gql } from "graphql-tag";
import { BaseSubgraph, type SubgraphArgs } from "@powerhousedao/reactor-api";
import { GraphIndexerProcessor } from "../../processors/graph-indexer/index.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";
import type { DB } from "../../processors/graph-indexer/schema.js";
import type { Kysely } from "kysely";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import { generateEmbedding } from "../../processors/graph-indexer/embedder.js";
import {
  searchSimilar,
  getEmbedding,
  upsertEmbedding,
} from "../../processors/graph-indexer/embedding-store.js";

export class KnowledgeGraphSubgraph extends BaseSubgraph {
  override name = "knowledgeGraph";

  override typeDefs = gql`
    type KnowledgeGraphNode {
      id: String!
      documentId: String!
      title: String
      description: String
      noteType: String
      status: String
      content: String
      author: String
      sourceOrigin: String
      createdAt: String
      topics: [String!]!
      updatedAt: String!
    }

    type KnowledgeGraphEdge {
      id: String!
      sourceDocumentId: String!
      targetDocumentId: String!
      linkType: String
      targetTitle: String
      updatedAt: String!
    }

    type GraphStats {
      nodeCount: Int!
      edgeCount: Int!
      orphanCount: Int!
    }

    type ConnectionResult {
      node: KnowledgeGraphNode!
      depth: Int!
      viaLinkType: String
    }

    type TopicInfo {
      name: String!
      noteCount: Int!
    }

    type RelatedNode {
      node: KnowledgeGraphNode!
      sharedTopics: [String!]!
      sharedTopicCount: Int!
    }

    extend type Query {
      knowledgeGraphNodes(driveId: ID!): [KnowledgeGraphNode!]!
      knowledgeGraphEdges(driveId: ID!): [KnowledgeGraphEdge!]!
      knowledgeGraphStats(driveId: ID!): GraphStats!
      knowledgeGraphNodeByDocumentId(
        driveId: ID!
        documentId: String!
      ): KnowledgeGraphNode
      knowledgeGraphOrphans(driveId: ID!): [KnowledgeGraphNode!]!
      knowledgeGraphConnections(
        driveId: ID!
        documentId: String!
        depth: Int
      ): [ConnectionResult!]!
      knowledgeGraphNodesByStatus(
        driveId: ID!
        status: String!
      ): [KnowledgeGraphNode!]!
      knowledgeGraphBacklinks(
        driveId: ID!
        documentId: String!
      ): [KnowledgeGraphEdge!]!
      knowledgeGraphDensity(driveId: ID!): Float!

      knowledgeGraphSearch(
        driveId: ID!
        query: String!
        limit: Int
      ): [KnowledgeGraphNode!]!
      knowledgeGraphTriangles(driveId: ID!, limit: Int): [Triangle!]!
      knowledgeGraphBridges(driveId: ID!): [KnowledgeGraphNode!]!
      knowledgeGraphForwardLinks(
        driveId: ID!
        documentId: String!
      ): [KnowledgeGraphEdge!]!

      knowledgeGraphTopics(driveId: ID!): [TopicInfo!]!
      knowledgeGraphByTopic(
        driveId: ID!
        topic: String!
      ): [KnowledgeGraphNode!]!
      knowledgeGraphRelatedByTopic(
        driveId: ID!
        documentId: String!
        limit: Int
      ): [RelatedNode!]!
      knowledgeGraphFullSearch(
        driveId: ID!
        query: String!
        limit: Int
      ): [KnowledgeGraphNode!]!
      knowledgeGraphByAuthor(
        driveId: ID!
        author: String!
      ): [KnowledgeGraphNode!]!
      knowledgeGraphByOrigin(
        driveId: ID!
        origin: String!
      ): [KnowledgeGraphNode!]!
      knowledgeGraphRecent(
        driveId: ID!
        limit: Int
        since: String
      ): [KnowledgeGraphNode!]!

      knowledgeGraphSemanticSearch(
        driveId: ID!
        query: String!
        limit: Int
      ): [SemanticResult!]!
      knowledgeGraphSimilar(
        driveId: ID!
        documentId: String!
        limit: Int
      ): [SemanticResult!]!
      knowledgeGraphHybridSearch(
        driveId: ID!
        query: String!
        limit: Int
      ): [HybridResult!]!

      knowledgeGraphHistory(
        driveId: ID!
        documentId: String!
        limit: Int
      ): [OperationRecord!]!
      knowledgeGraphActivity(
        driveId: ID!
        limit: Int
        since: String
      ): [OperationRecord!]!
      knowledgeGraphActivityByType(
        driveId: ID!
        operationType: String!
        limit: Int
      ): [OperationRecord!]!
      knowledgeGraphStale(
        driveId: ID!
        since: String!
        limit: Int
      ): [KnowledgeGraphNode!]!

      """
      Debug: raw processor DB tables
      """
      knowledgeGraphDebug(driveId: ID!): GraphDebugInfo!
    }

    type Triangle {
      noteA: KnowledgeGraphNode!
      noteB: KnowledgeGraphNode!
      sharedTarget: KnowledgeGraphNode!
    }

    type SemanticResult {
      node: KnowledgeGraphNode!
      similarity: Float!
    }

    type HybridResult {
      node: KnowledgeGraphNode!
      score: Float!
      matchedBy: [String!]!
    }

    type OperationRecord {
      id: String!
      documentId: String!
      operationType: String!
      timestamp: String!
      index: Int!
      scope: String!
      summary: String
      signerAddress: String
      signerApp: String
    }

    type GraphDebugInfo {
      rawNodeCount: Int!
      rawEdgeCount: Int!
      rawNodes: [KnowledgeGraphNode!]!
      rawEdges: [KnowledgeGraphEdge!]!
      processorNamespace: String!
    }

    type ReindexResult {
      indexedNodes: Int!
      indexedEdges: Int!
      errors: [String!]!
    }

    extend type Mutation {
      """
      Backfill the graph index by reading all bai/knowledge-note and bai/moc documents
      in the drive. Use when the processor missed historical operations.
      """
      knowledgeGraphReindex(driveId: ID!): ReindexResult!
    }
  `;

  override resolvers = {
    KnowledgeGraphNode: {
      topics: async (parent: {
        documentId: string;
        topics?: string[];
        _driveId?: string;
      }) => {
        // If topics were already resolved inline, return them
        if (parent.topics) return parent.topics;
        // Otherwise resolve via field resolver using _driveId hint
        if (parent._driveId) {
          const query = this.getQuery(parent._driveId);
          return query.topicsForNode(parent.documentId);
        }
        return [];
      },
    },
    Mutation: {
      knowledgeGraphReindex: (_: unknown, args: { driveId: string }) =>
        this.reindexDrive(args.driveId),
    },
    Query: {
      knowledgeGraphNodes: async (_: unknown, args: { driveId: string }) => {
        await this.ensureGraphDoc(args.driveId);
        const query = this.getQuery(args.driveId);
        const nodes = await query.allNodes();
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphEdges: async (_: unknown, args: { driveId: string }) => {
        await this.ensureGraphDoc(args.driveId);
        const query = this.getQuery(args.driveId);
        return query.allEdges();
      },

      knowledgeGraphStats: async (_: unknown, args: { driveId: string }) => {
        await this.ensureGraphDoc(args.driveId);
        const query = this.getQuery(args.driveId);
        return query.stats();
      },

      knowledgeGraphNodeByDocumentId: async (
        _: unknown,
        args: { driveId: string; documentId: string },
      ) => {
        const query = this.getQuery(args.driveId);
        const node = await query.nodeByDocumentId(args.documentId);
        return node ? { ...node, _driveId: args.driveId } : null;
      },

      knowledgeGraphOrphans: async (_: unknown, args: { driveId: string }) => {
        const query = this.getQuery(args.driveId);
        const nodes = await query.orphanNodes();
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphConnections: async (
        _: unknown,
        args: { driveId: string; documentId: string; depth?: number },
      ) => {
        const query = this.getQuery(args.driveId);
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
        const query = this.getQuery(args.driveId);
        const nodes = await query.nodesByStatus(args.status);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphBacklinks: async (
        _: unknown,
        args: { driveId: string; documentId: string },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.backlinks(args.documentId);
      },

      knowledgeGraphDensity: async (_: unknown, args: { driveId: string }) => {
        const query = this.getQuery(args.driveId);
        return query.density();
      },

      knowledgeGraphSearch: async (
        _: unknown,
        args: { driveId: string; query: string; limit?: number },
      ) => {
        const query = this.getQuery(args.driveId);
        const nodes = await query.searchNodes(args.query, args.limit ?? 50);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphTriangles: async (
        _: unknown,
        args: { driveId: string; limit?: number },
      ) => {
        const query = this.getQuery(args.driveId);
        const triangles = await query.triangles(args.limit ?? 20);
        return triangles.map((t) => ({
          noteA: { ...t.a, _driveId: args.driveId },
          noteB: { ...t.b, _driveId: args.driveId },
          sharedTarget: { ...t.sharedTarget, _driveId: args.driveId },
        }));
      },

      knowledgeGraphBridges: async (_: unknown, args: { driveId: string }) => {
        const query = this.getQuery(args.driveId);
        const nodes = await query.bridges();
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphForwardLinks: async (
        _: unknown,
        args: { driveId: string; documentId: string },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.forwardLinks(args.documentId);
      },

      // --- Phase 1: new query resolvers ---

      knowledgeGraphTopics: async (_: unknown, args: { driveId: string }) => {
        const query = this.getQuery(args.driveId);
        return query.topicStats();
      },

      knowledgeGraphByTopic: async (
        _: unknown,
        args: { driveId: string; topic: string },
      ) => {
        const query = this.getQuery(args.driveId);
        const nodes = await query.nodesByTopic(args.topic);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphRelatedByTopic: async (
        _: unknown,
        args: { driveId: string; documentId: string; limit?: number },
      ) => {
        const query = this.getQuery(args.driveId);
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
        const query = this.getQuery(args.driveId);
        const nodes = await query.fullSearch(args.query, args.limit ?? 50);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphByAuthor: async (
        _: unknown,
        args: { driveId: string; author: string },
      ) => {
        const query = this.getQuery(args.driveId);
        const nodes = await query.nodesByAuthor(args.author);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphByOrigin: async (
        _: unknown,
        args: { driveId: string; origin: string },
      ) => {
        const query = this.getQuery(args.driveId);
        const nodes = await query.nodesByOrigin(args.origin);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphRecent: async (
        _: unknown,
        args: { driveId: string; limit?: number; since?: string },
      ) => {
        const query = this.getQuery(args.driveId);
        const nodes = await query.recentNodes(
          args.limit ?? 20,
          args.since ?? undefined,
        );
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphSemanticSearch: async (
        _: unknown,
        args: { driveId: string; query: string; limit?: number },
      ) => {
        const queryEmbedding = await generateEmbedding(args.query);
        const results = await searchSimilar(queryEmbedding, args.limit ?? 10);
        const graphQuery = this.getQuery(args.driveId);

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
        const graphQuery = this.getQuery(args.driveId);

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
        const graphQuery = this.getQuery(args.driveId);
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

      knowledgeGraphHistory: async (
        _: unknown,
        args: { driveId: string; documentId: string; limit?: number },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.history(args.documentId, args.limit ?? 50);
      },

      knowledgeGraphActivity: async (
        _: unknown,
        args: { driveId: string; limit?: number; since?: string },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.activity(args.limit ?? 50, args.since ?? undefined);
      },

      knowledgeGraphActivityByType: async (
        _: unknown,
        args: { driveId: string; operationType: string; limit?: number },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.activityByType(args.operationType, args.limit ?? 50);
      },

      knowledgeGraphStale: async (
        _: unknown,
        args: { driveId: string; since: string; limit?: number },
      ) => {
        const query = this.getQuery(args.driveId);
        const nodes = await query.staleNodes(args.since, args.limit ?? 50);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphDebug: async (_: unknown, args: { driveId: string }) => {
        const namespace = GraphIndexerProcessor.getNamespace(args.driveId);
        try {
          const db = this.getDb(args.driveId);
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

  constructor(args: SubgraphArgs) {
    super(args);
  }

  /**
   * Returns a Kysely<DB> instance scoped to the processor's namespace
   * for the given drive. Centralizes the Legacy -> IRelationalDb cast.
   */
  /**
   * Read-only namespaced query builder — use for all SELECT resolvers.
   */
  private getDb(driveId: string): Kysely<DB> {
    return GraphIndexerProcessor.query(
      driveId,
      this.relationalDb as unknown as IRelationalDb,
    ) as unknown as Kysely<DB>;
  }

  /**
   * Writable namespaced Kysely instance — use for reindex (INSERT/DELETE).
   * createNamespace returns a full Kysely, not the read-only query builder.
   */
  private async getWritableDb(driveId: string): Promise<Kysely<DB>> {
    const namespace = GraphIndexerProcessor.getNamespace(driveId);
    return (await this.relationalDb.createNamespace(
      namespace,
    )) as unknown as Kysely<DB>;
  }

  private getQuery(driveId: string) {
    return createGraphQuery(this.getDb(driveId));
  }

  /**
   * Ensures a bai/knowledge-graph document exists in the given drive.
   * Called lazily on first query -- supports API/plugin access without
   * requiring the Connect UI to have initialized the drive first.
   */
  private ensuredDrives = new Set<string>();

  private async reindexDrive(
    driveId: string,
  ): Promise<{ indexedNodes: number; indexedEdges: number; errors: string[] }> {
    const errors: string[] = [];
    let indexedNodes = 0;
    let indexedEdges = 0;

    try {
      const drive = await this.reactorClient.get(driveId);
      const nodes = (
        drive.state as unknown as {
          global: {
            nodes: Array<{
              kind: string;
              documentType?: string;
              id: string;
            }>;
          };
        }
      ).global.nodes;

      const noteNodes = nodes.filter(
        (n) =>
          n.kind === "file" &&
          (n.documentType === "bai/knowledge-note" ||
            n.documentType === "bai/moc"),
      );

      const db = await this.getWritableDb(driveId);
      const now = new Date().toISOString();

      for (const node of noteNodes) {
        try {
          const doc = await this.reactorClient.get(node.id);
          const state = doc.state as unknown as {
            global: Record<string, unknown>;
          };
          const global = state.global;

          // Extract provenance
          const provenance = global.provenance as
            | {
                author?: string;
                sourceOrigin?: string;
                createdAt?: string;
              }
            | undefined;

          await db
            .insertInto("graph_nodes")
            .values({
              id: node.id,
              document_id: node.id,
              title: (global.title as string) ?? null,
              description: (global.description as string) ?? null,
              note_type: (global.noteType as string) ?? null,
              status: (global.status as string) ?? "DRAFT",
              content: (global.content as string) ?? null,
              author: provenance?.author ?? null,
              source_origin: provenance?.sourceOrigin ?? null,
              created_at: provenance?.createdAt ?? null,
              updated_at: now,
            })
            .onConflict((oc) =>
              oc.column("document_id").doUpdateSet({
                title: (global.title as string) ?? null,
                description: (global.description as string) ?? null,
                note_type: (global.noteType as string) ?? null,
                status: (global.status as string) ?? "DRAFT",
                content: (global.content as string) ?? null,
                author: provenance?.author ?? null,
                source_origin: provenance?.sourceOrigin ?? null,
                created_at: provenance?.createdAt ?? null,
                updated_at: now,
              }),
            )
            .execute();
          indexedNodes++;

          // Reconcile topics
          await db
            .deleteFrom("graph_topics")
            .where("document_id", "=", node.id)
            .execute();

          const topics =
            (global.topics as Array<string | Record<string, unknown>>) ?? [];
          if (topics.length > 0) {
            await db
              .insertInto("graph_topics")
              .values(
                topics.map((topic, idx) => {
                  const name =
                    typeof topic === "string"
                      ? topic
                      : ((topic.name as string) ?? "");
                  return {
                    id: `${node.id}-topic-${idx}`,
                    document_id: node.id,
                    name,
                    updated_at: now,
                  };
                }),
              )
              .execute();
          }

          // Reconcile edges
          await db
            .deleteFrom("graph_edges")
            .where("source_document_id", "=", node.id)
            .execute();

          const links = (global.links as Array<Record<string, unknown>>) ?? [];
          if (links.length > 0) {
            await db
              .insertInto("graph_edges")
              .values(
                links.map((link) => ({
                  id:
                    (link.id as string) ??
                    `${node.id}-${link.targetDocumentId as string}`,
                  source_document_id: node.id,
                  target_document_id: (link.targetDocumentId as string) ?? "",
                  link_type: (link.linkType as string) ?? null,
                  target_title: (link.targetTitle as string) ?? null,
                  updated_at: now,
                })),
              )
              .execute();
            indexedEdges += links.length;
          }

          // Generate embedding for semantic search
          const text = [global.title, global.description, global.content]
            .filter(Boolean)
            .join(" ");
          if (text.length > 0) {
            try {
              const emb = await generateEmbedding(text);
              await upsertEmbedding(node.id, emb);
            } catch (embErr: unknown) {
              console.warn(
                `[KnowledgeGraphSubgraph] Embedding failed for ${node.id}:`,
                embErr,
              );
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${node.id}: ${msg}`);
        }
      }

      console.log(
        `[KnowledgeGraphSubgraph] Reindex complete: ${indexedNodes} nodes, ${indexedEdges} edges, ${errors.length} errors`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Drive read failed: ${msg}`);
    }

    return { indexedNodes, indexedEdges, errors };
  }

  private async ensureGraphDoc(driveId: string): Promise<void> {
    if (this.ensuredDrives.has(driveId)) return;
    this.ensuredDrives.add(driveId);

    try {
      // Check if a knowledge-graph doc already exists anywhere in the drive
      const drive = await this.reactorClient.get(driveId);
      const nodes = (
        drive.state as unknown as {
          global: {
            nodes: Array<{
              kind: string;
              documentType?: string;
              id: string;
              name: string;
              parentFolder?: string | null;
            }>;
          };
        }
      ).global.nodes;

      const hasGraph = nodes.some(
        (n) => n.kind === "file" && n.documentType === "bai/knowledge-graph",
      );

      if (!hasGraph) {
        // Find the /self folder to place the graph doc in the correct location
        const selfFolder = nodes.find(
          (n) =>
            n.kind === "folder" && n.name === "self" && n.parentFolder == null,
        );
        const parentFolder = selfFolder?.id;

        await this.reactorClient.createEmpty("bai/knowledge-graph", {
          parentIdentifier: parentFolder ?? driveId,
        });
        console.log(
          `[KnowledgeGraphSubgraph] Auto-created KnowledgeGraph in drive ${driveId}` +
            (parentFolder
              ? ` (folder: /self/)`
              : ` (drive root -- /self/ folder not found)`),
        );
      }
    } catch (err: unknown) {
      console.error(
        `[KnowledgeGraphSubgraph] Failed to ensure graph doc:`,
        err,
      );
      // Don't block queries if this fails -- processor data still works
    }
  }
}
