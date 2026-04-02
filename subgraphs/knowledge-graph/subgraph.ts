import { gql } from "graphql-tag";
import { BaseSubgraph, type SubgraphArgs } from "@powerhousedao/reactor-api";
import { GraphIndexerProcessor } from "../../processors/graph-indexer/index.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";
import type { DB } from "../../processors/graph-indexer/schema.js";
import type { Kysely } from "kysely";
import type { IRelationalDb } from "@powerhousedao/shared/processors";

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
      Backfill the graph index by reading all bai/knowledge-note documents
      in the drive. Use when the processor missed historical operations.
      """
      knowledgeGraphReindex(driveId: ID!): ReindexResult!
    }
  `;

  override resolvers = {
    Mutation: {
      knowledgeGraphReindex: (_: unknown, args: { driveId: string }) =>
        this.reindexDrive(args.driveId),
    },
    Query: {
      knowledgeGraphNodes: async (_: unknown, args: { driveId: string }) => {
        await this.ensureGraphDoc(args.driveId);
        const query = this.getQuery(args.driveId);
        return query.allNodes();
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
        return query.nodeByDocumentId(args.documentId) ?? null;
      },

      knowledgeGraphOrphans: async (_: unknown, args: { driveId: string }) => {
        const query = this.getQuery(args.driveId);
        return query.orphanNodes();
      },

      knowledgeGraphConnections: async (
        _: unknown,
        args: { driveId: string; documentId: string; depth?: number },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.connections(args.documentId, args.depth ?? 2);
      },

      knowledgeGraphNodesByStatus: async (
        _: unknown,
        args: { driveId: string; status: string },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.nodesByStatus(args.status);
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
        return query.searchNodes(args.query, args.limit ?? 50);
      },

      knowledgeGraphTriangles: async (
        _: unknown,
        args: { driveId: string; limit?: number },
      ) => {
        const query = this.getQuery(args.driveId);
        const triangles = await query.triangles(args.limit ?? 20);
        return triangles.map((t) => ({
          noteA: t.a,
          noteB: t.b,
          sharedTarget: t.sharedTarget,
        }));
      },

      knowledgeGraphBridges: async (_: unknown, args: { driveId: string }) => {
        const query = this.getQuery(args.driveId);
        return query.bridges();
      },

      knowledgeGraphForwardLinks: async (
        _: unknown,
        args: { driveId: string; documentId: string },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.forwardLinks(args.documentId);
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
              updatedAt: r.updated_at,
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
   * for the given drive. Centralizes the Legacy → IRelationalDb cast.
   */
  private getDb(driveId: string): Kysely<DB> {
    return GraphIndexerProcessor.query(
      driveId,
      this.relationalDb as unknown as IRelationalDb,
    ) as unknown as Kysely<DB>;
  }

  private getQuery(driveId: string) {
    return createGraphQuery(this.getDb(driveId));
  }

  /**
   * Ensures a bai/knowledge-graph document exists in the given drive.
   * Called lazily on first query — supports API/plugin access without
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
        (n) => n.kind === "file" && n.documentType === "bai/knowledge-note",
      );

      const db = this.getDb(driveId);
      const now = new Date().toISOString();

      for (const node of noteNodes) {
        try {
          const doc = await this.reactorClient.get(node.id);
          const state = doc.state as unknown as {
            global: Record<string, unknown>;
          };
          const global = state.global;

          await db
            .insertInto("graph_nodes")
            .values({
              id: node.id,
              document_id: node.id,
              title: (global.title as string) ?? null,
              description: (global.description as string) ?? null,
              note_type: (global.noteType as string) ?? null,
              status: (global.status as string) ?? "DRAFT",
              updated_at: now,
            })
            .onConflict((oc) =>
              oc.column("document_id").doUpdateSet({
                title: (global.title as string) ?? null,
                description: (global.description as string) ?? null,
                note_type: (global.noteType as string) ?? null,
                status: (global.status as string) ?? "DRAFT",
                updated_at: now,
              }),
            )
            .execute();
          indexedNodes++;

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
              : ` (drive root — /self/ folder not found)`),
        );
      }
    } catch (err: unknown) {
      console.error(
        `[KnowledgeGraphSubgraph] Failed to ensure graph doc:`,
        err,
      );
      // Don't block queries if this fails — processor data still works
    }
  }
}
