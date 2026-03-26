import { gql } from "graphql-tag";
import {
  BaseSubgraph,
  type SubgraphArgs,
  type Context,
} from "@powerhousedao/reactor-api";
import { GraphIndexerProcessor } from "../../processors/graph-indexer/index.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";
import type { DB } from "../../processors/graph-indexer/schema.js";
import type { Kysely } from "kysely";

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
      knowledgeGraphNodesByStatus(driveId: ID!, status: String!): [KnowledgeGraphNode!]!
      knowledgeGraphBacklinks(driveId: ID!, documentId: String!): [KnowledgeGraphEdge!]!
      knowledgeGraphDensity(driveId: ID!): Float!
    }
  `;

  override resolvers = {
    Query: {
      knowledgeGraphNodes: async (
        _: unknown,
        args: { driveId: string },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.allNodes();
      },

      knowledgeGraphEdges: async (
        _: unknown,
        args: { driveId: string },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.allEdges();
      },

      knowledgeGraphStats: async (
        _: unknown,
        args: { driveId: string },
      ) => {
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

      knowledgeGraphOrphans: async (
        _: unknown,
        args: { driveId: string },
      ) => {
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

      knowledgeGraphDensity: async (
        _: unknown,
        args: { driveId: string },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.density();
      },
    },
  };

  constructor(args: SubgraphArgs) {
    super(args);
  }

  private getQuery(driveId: string) {
    const namespace = GraphIndexerProcessor.getNamespace(driveId);
    const scopedDb = this.relationalDb.withSchema(namespace) as unknown as Kysely<DB>;
    return createGraphQuery(scopedDb);
  }
}
